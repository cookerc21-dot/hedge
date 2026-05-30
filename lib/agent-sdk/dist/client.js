import { AGENT_TYPES } from "./types.js";
import { resolveNetworkConfig } from "./config.js";
import { resolveKey, signWalletLink } from "./wallet.js";
import { createClients, encodeStringMetadata, identityTuple, walletLinkDeadline, ReputationRegistryABI, writeContractDirect } from "./contracts.js";
import { generateAgentCard, mergeAgentCard, fetchAgentCard, checkServiceReachability } from "./card.js";
import { AgentReadClient } from "./read-client.js";
import { AgentSdkError, ContractError, SimulationError, StorageError, ValidationError, assertReceiptSuccess, formatContractError } from "./errors.js";
import { loadKeystore, decryptKey } from "./keystore.js";
import { simulateOnly } from "./simulate.js";
import { AuditLogger } from "./audit.js";
import { validateStringField, VALIDATION_LIMITS } from "./validation.js";
import { isAddress, keccak256, toHex, decodeEventLog } from "viem";
// Injective's EVM RPC returns ~160_000_000 (0.16 gwei) for eth_gasPrice.
// Only fall back to the default when the RPC returns literal 0.
const DEFAULT_GAS_PRICE = 160000000n; // 0.16 gwei — matches Injective mainnet eth_gasPrice
const MIN_VALID_GAS_PRICE = 1n; // treat anything > 0 as valid; only reject literal 0
/** Fetch gas price from the RPC; fall back to DEFAULT_GAS_PRICE if the node returns 0. */
async function resolveGasPrice(publicClient, override) {
    if (override !== undefined)
        return override;
    try {
        const price = await publicClient.getGasPrice();
        return price >= MIN_VALID_GAS_PRICE ? price : DEFAULT_GAS_PRICE;
    }
    catch {
        return DEFAULT_GAS_PRICE;
    }
}
const REGISTERED_EVENT_TOPIC = keccak256(toHex("Registered(uint256,string,address)"));
const NEW_FEEDBACK_EVENT_TOPIC = keccak256(toHex("NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)"));
const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
const MIME_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".webp": "image/webp",
};
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
export class AgentClient {
    address;
    injAddress;
    config;
    key;
    storage;
    callbacks;
    clients;
    audit;
    _readClient;
    constructor(opts) {
        this.config = resolveNetworkConfig({ network: opts.network, rpcUrl: opts.rpcUrl });
        let rawKey;
        if (opts.privateKey) {
            rawKey = opts.privateKey;
        }
        else if (opts.keystorePassword !== undefined) {
            const ks = loadKeystore(opts.keystorePath);
            rawKey = decryptKey({ keystore: ks, password: opts.keystorePassword });
        }
        else {
            throw new ValidationError("No signing key provided. Pass privateKey, or keystorePassword + keystorePath to use keystore.");
        }
        this.key = resolveKey(rawKey);
        this.storage = opts.storage;
        this.callbacks = opts.callbacks ?? {};
        this.address = this.key.address;
        this.injAddress = this.key.injAddress;
        this.clients = createClients(this.config, this.key.account);
        this.audit = new AuditLogger({
            source: opts.auditSource,
            logPath: opts.auditLogPath,
            enabled: opts.audit !== false,
        });
    }
    get readClient() {
        return (this._readClient ??= new AgentReadClient({ network: this.config.name, rpcUrl: this.config.rpcUrl }));
    }
    get auditBase() {
        return { network: this.config.name, chainId: this.config.chainId, signerAddress: this.key.address, contract: this.config.identityRegistry };
    }
    get reputationAuditBase() {
        return { ...this.auditBase, contract: this.config.reputationRegistry };
    }
    async register(opts) {
        validateStringField(opts.name, "name", VALIDATION_LIMITS.NAME_MAX_BYTES, true);
        if (!AGENT_TYPES.includes(opts.type))
            throw new ValidationError(`Invalid agent type "${opts.type}". Must be one of: ${AGENT_TYPES.join(", ")}.`);
        validateStringField(opts.description, "description", VALIDATION_LIMITS.DESCRIPTION_MAX_BYTES, false);
        validateStringField(opts.builderCode, "builderCode", VALIDATION_LIMITS.BUILDER_CODE_MAX_BYTES, true);
        if (!isAddress(opts.wallet))
            throw new ValidationError(`Invalid wallet address: ${opts.wallet}. Must be a checksummed 0x address.`);
        const { publicClient, identityRegistry, account } = this.clients;
        const [resolvedImage] = opts.dryRun
            ? [undefined]
            : await Promise.all([
                opts.image ? this.resolveImage(opts.image) : Promise.resolve(undefined),
                opts.services?.length ? this.checkServices(opts.services.map(s => s.endpoint)) : Promise.resolve(),
            ]);
        const card = generateAgentCard({
            name: opts.name, type: opts.type, description: opts.description,
            builderCode: opts.builderCode, operatorAddress: this.key.address,
            services: opts.services, image: resolvedImage, x402: opts.x402,
            chainId: this.config.chainId, actions: opts.actions,
            registryAddress: this.config.identityRegistry,
            supportedTrust: opts.supportedTrust,
            tags: opts.tags, version: opts.version, license: opts.license,
            sourceCode: opts.sourceCode, documentation: opts.documentation,
        });
        const metadata = [
            { metadataKey: "builderCode", metadataValue: encodeStringMetadata(opts.builderCode) },
            { metadataKey: "agentType", metadataValue: encodeStringMetadata(opts.type) },
        ];
        if (opts.version)
            metadata.push({ metadataKey: "version", metadataValue: encodeStringMetadata(opts.version) });
        if (opts.license)
            metadata.push({ metadataKey: "license", metadataValue: encodeStringMetadata(opts.license) });
        if (opts.sourceCode)
            metadata.push({ metadataKey: "sourceCode", metadataValue: encodeStringMetadata(opts.sourceCode) });
        if (opts.documentation)
            metadata.push({ metadataKey: "documentation", metadataValue: encodeStringMetadata(opts.documentation) });
        if (opts.tags && opts.tags.length > 0)
            metadata.push({ metadataKey: "tags", metadataValue: encodeStringMetadata(JSON.stringify(opts.tags)) });
        let cardUri;
        if (opts.uri) {
            cardUri = opts.uri;
        }
        else if (opts.dryRun) {
            cardUri = "ipfs://dry-run-placeholder";
        }
        else {
            if (!this.storage)
                throw new StorageError("No storage provider configured. Provide a uri or configure a StorageProvider.");
            this.callbacks.onProgress?.("Uploading agent card to IPFS...");
            cardUri = await this.storage.uploadJSON(card, card.name);
        }
        const baseParams = {
            address: this.config.identityRegistry,
            abi: identityRegistry.abi,
            account,
        };
        if (opts.dryRun) {
            const sim = await simulateOnly(publicClient, {
                ...baseParams, functionName: "register", args: [cardUri, metadata],
                gasPrice: opts.gasPrice ? opts.gasPrice * BigInt(1e9) : undefined, gas: 1500000n,
            }, this.callbacks);
            return { agentId: sim.result, identityTuple: "", cardUri, txHashes: [], scanUrl: "", gasEstimate: sim.gasEstimate };
        }
        let nonce = await publicClient.getTransactionCount({ address: this.key.address, blockTag: "pending" });
        const txHashes = [];
        let walletTxHash;
        let setUriTxHash;
        const gasPrice = opts.gasPrice ? opts.gasPrice * BigInt(1e9) : await resolveGasPrice(publicClient);
        const evmBalance = await publicClient.getBalance({ address: this.key.address });
        this.callbacks.onProgress?.(`Gas price: ${gasPrice / BigInt(1e9)} gwei | EVM balance: ${evmBalance} wei (${Number(evmBalance) / 1e18} INJ)`);
        const startMs = Date.now();
        const registerAuditArgs = AuditLogger.sanitizeArgs("register", [cardUri, metadata]);
        try {
            const registerSim = await simulateOnly(publicClient, {
                ...baseParams, functionName: "register", args: [cardUri, metadata], gasPrice, gas: 1500000n,
            }, this.callbacks);
            this.audit.log({ event: "tx:simulate", ...this.auditBase, method: "register", args: registerAuditArgs,
                simulation: { passed: true, gasEstimate: String(registerSim.gasEstimate) }, durationMs: Date.now() - startMs });
            // Use estimate + 20% buffer as the gas limit for broadcast.
            const registerGasLimit = registerSim.gasEstimate > 0n
                ? registerSim.gasEstimate * 12n / 10n
                : 1500000n;
            const registerCost = registerGasLimit * gasPrice;
            this.callbacks.onProgress?.(`Broadcasting register (gas limit: ${registerGasLimit}, cost: ${registerCost} wei = ${Number(registerCost) / 1e18} INJ)...`);
            const registerHash = await writeContractDirect({
                publicClient, account, chainId: this.config.chainId,
                address: baseParams.address, abi: baseParams.abi,
                functionName: "register", args: [cardUri, metadata],
                nonce: nonce++, gasPrice, gas: registerGasLimit,
                rpcUrl: this.config.rpcUrl,
            });
            txHashes.push(registerHash);
            this.audit.log({ event: "tx:broadcast", ...this.auditBase, method: "register", args: registerAuditArgs,
                simulation: { passed: true, gasEstimate: String(registerSim.gasEstimate) },
                durationMs: Date.now() - startMs, result: { txHash: registerHash } });
            const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
            assertReceiptSuccess(receipt, "register", registerHash);
            this.audit.log({ event: "tx:confirm", ...this.auditBase, method: "register", args: registerAuditArgs, durationMs: Date.now() - startMs, result: { txHash: registerHash, gasUsed: String(receipt.gasUsed), blockNumber: String(receipt.blockNumber) } });
            const registeredLog = receipt.logs.find((log) => log.address.toLowerCase() === this.config.identityRegistry.toLowerCase() &&
                log.topics[0] === REGISTERED_EVENT_TOPIC);
            if (!registeredLog?.topics[1])
                throw new ContractError("Failed to extract agentId from register transaction.");
            const agentId = BigInt(registeredLog.topics[1]);
            // Two-phase: re-upload card with the confirmed agentId in registrations.
            // Wrapped in its own try/catch — registration already succeeded; a failure
            // here is a warning, not a fatal error. The caller still gets the agentId.
            if (card.registrations?.length && this.storage && !opts.uri && !opts.dryRun) {
                try {
                    // Convert to number for JSON serialization — agentIds are small
                    // integers that will never overflow Number.MAX_SAFE_INTEGER.
                    card.registrations[0].agentId = Number(agentId);
                    card.updatedAt = Math.floor(Date.now() / 1000);
                    this.callbacks.onProgress?.("Re-uploading card with confirmed agentId...");
                    const updatedUri = await this.storage.uploadJSON(card, card.name);
                    if (updatedUri !== cardUri) {
                        const setUriArgs = [agentId, updatedUri];
                        const setUriAuditArgs = AuditLogger.sanitizeArgs("setAgentURI", setUriArgs);
                        this.callbacks.onProgress?.("Broadcasting setAgentURI...");
                        const setUriHash = await writeContractDirect({
                            publicClient, account, chainId: this.config.chainId,
                            address: baseParams.address, abi: baseParams.abi,
                            functionName: "setAgentURI", args: setUriArgs,
                            nonce: nonce++, gasPrice, gas: 100000n,
                            rpcUrl: this.config.rpcUrl,
                        });
                        txHashes.push(setUriHash);
                        setUriTxHash = setUriHash;
                        this.audit.log({ event: "tx:broadcast", ...this.auditBase, method: "setAgentURI", args: setUriAuditArgs,
                            durationMs: Date.now() - startMs, result: { txHash: setUriHash } });
                        cardUri = updatedUri;
                    }
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.callbacks.onWarning?.(`Agent #${agentId} registered but two-phase URI update failed: ${msg}. ` +
                        `The on-chain URI still points to the card with agentId:null. Run 'update ${agentId} --uri <new-cid>' to fix.`);
                    this.audit.log({ event: "tx:fail", ...this.auditBase, method: "setAgentURI",
                        args: {}, durationMs: Date.now() - startMs, error: { code: "TwoPhaseUpdateFailed", message: msg } });
                }
            }
            if (opts.wallet.toLowerCase() === this.key.address.toLowerCase()) {
                const deadline = walletLinkDeadline();
                const sig = await signWalletLink({
                    agentId, wallet: opts.wallet, ownerAddress: this.key.address, deadline,
                    account: this.key.account, chainId: this.config.chainId,
                    contractAddress: this.config.identityRegistry,
                });
                const walletArgs = [agentId, opts.wallet, deadline, sig];
                const walletAuditArgs = AuditLogger.sanitizeArgs("setAgentWallet", walletArgs);
                const walletSim = await simulateOnly(publicClient, {
                    ...baseParams, functionName: "setAgentWallet", args: walletArgs, gasPrice, gas: 300000n,
                }, this.callbacks);
                this.audit.log({ event: "tx:simulate", ...this.auditBase, method: "setAgentWallet", args: walletAuditArgs,
                    simulation: { passed: true, gasEstimate: String(walletSim.gasEstimate) }, durationMs: Date.now() - startMs });
                const walletGasLimit = walletSim.gasEstimate > 0n ? walletSim.gasEstimate * 12n / 10n : 300000n;
                this.callbacks.onProgress?.("Broadcasting setAgentWallet...");
                const walletHash = await writeContractDirect({
                    publicClient, account, chainId: this.config.chainId,
                    address: baseParams.address, abi: baseParams.abi,
                    functionName: "setAgentWallet", args: walletArgs,
                    nonce: nonce++, gasPrice, gas: walletGasLimit,
                    rpcUrl: this.config.rpcUrl,
                });
                txHashes.push(walletHash);
                walletTxHash = walletHash;
                this.audit.log({ event: "tx:broadcast", ...this.auditBase, method: "setAgentWallet", args: walletAuditArgs,
                    simulation: { passed: true, gasEstimate: String(walletSim.gasEstimate) },
                    durationMs: Date.now() - startMs, result: { txHash: walletHash } });
            }
            else {
                this.callbacks.onWarning?.(`Skipping wallet linkage: wallet (${opts.wallet}) differs from signer (${this.key.address}).`);
            }
            // Wait for the optional setUri / wallet-link follow-up txs and verify
            // they landed. setUri reverts are non-fatal (registration already
            // succeeded; the agent just keeps its agentId:null card — same recovery
            // hint as the broadcast-failure path above). Wallet-link reverts are
            // fatal because the caller asked for the link.
            const followupReceipts = await Promise.all(txHashes.slice(1).map(hash => publicClient.waitForTransactionReceipt({ hash })));
            followupReceipts.forEach((r, i) => {
                if (r.status === "success")
                    return;
                const hash = txHashes[i + 1];
                if (hash === setUriTxHash) {
                    this.callbacks.onWarning?.(`Agent #${agentId} registered, but the two-phase setAgentURI tx ${hash} reverted on-chain. ` +
                        `The on-chain URI still points to the card with agentId:null. Run 'update ${agentId} --uri <new-cid>' to fix.`);
                    this.audit.log({ event: "tx:fail", ...this.auditBase, method: "setAgentURI",
                        args: {}, durationMs: Date.now() - startMs, error: { code: "ReceiptReverted", message: `tx ${hash} reverted` } });
                    return;
                }
                if (hash === walletTxHash) {
                    throw new ContractError(`setAgentWallet tx ${hash} reverted on-chain after broadcast.`);
                }
                // Defensive: any other follow-up hash we don't recognize.
                throw new ContractError(`Follow-up tx ${hash} (after register) reverted on-chain.`);
            });
            const tuple = identityTuple(this.config, agentId);
            return {
                agentId,
                identityTuple: tuple,
                cardUri,
                txHashes,
                walletTxHash,
                setUriTxHash,
                scanUrl: `https://8004scan.io/agent/${tuple}`,
            };
        }
        catch (error) {
            if (error instanceof SimulationError || error instanceof AgentSdkError) {
                this.audit.log({ event: "tx:fail", ...this.auditBase, method: "register", args: registerAuditArgs, durationMs: Date.now() - startMs, error: { code: error.name, message: error.message } });
                throw error;
            }
            const formatted = formatContractError(error);
            this.audit.log({ event: "tx:fail", ...this.auditBase, method: "register", args: registerAuditArgs, durationMs: Date.now() - startMs, error: { code: formatted.name, message: formatted.message } });
            throw formatted;
        }
    }
    async update(agentId, opts) {
        if (!opts.builderCode && !opts.type && !opts.uri && !opts.wallet &&
            !opts.name && !opts.description && !opts.services?.length &&
            !opts.removeServices?.length && !opts.image && opts.x402 === undefined &&
            opts.actions === undefined && opts.active === undefined &&
            opts.supportedTrust === undefined &&
            opts.tags === undefined && !opts.version && !opts.license &&
            !opts.sourceCode && !opts.documentation) {
            throw new ValidationError("No fields to update. Provide at least one update option.");
        }
        if (opts.wallet && !isAddress(opts.wallet)) {
            throw new ValidationError(`Invalid wallet address: ${opts.wallet}. Must be a checksummed 0x address.`);
        }
        if (opts.type && !AGENT_TYPES.includes(opts.type)) {
            throw new ValidationError(`Invalid agent type "${opts.type}". Must be one of: ${AGENT_TYPES.join(", ")}.`);
        }
        validateStringField(opts.name, "name", VALIDATION_LIMITS.NAME_MAX_BYTES, false);
        validateStringField(opts.description, "description", VALIDATION_LIMITS.DESCRIPTION_MAX_BYTES, false);
        validateStringField(opts.builderCode, "builderCode", VALIDATION_LIMITS.BUILDER_CODE_MAX_BYTES, false);
        const { publicClient, identityRegistry, account } = this.clients;
        const contractArgs = { address: this.config.identityRegistry, abi: identityRegistry.abi };
        const hasCardChanges = !!(opts.name || opts.description || opts.services?.length ||
            opts.removeServices?.length || opts.image || opts.x402 !== undefined ||
            opts.actions !== undefined || opts.active !== undefined ||
            opts.tags !== undefined || opts.version || opts.license ||
            opts.sourceCode || opts.documentation);
        const [owner, tokenUri] = await Promise.all([
            publicClient.readContract({ ...contractArgs, functionName: "ownerOf", args: [agentId] }),
            hasCardChanges && !opts.uri
                ? publicClient.readContract({ ...contractArgs, functionName: "tokenURI", args: [agentId] })
                : Promise.resolve(null),
        ]);
        if (owner.toLowerCase() !== this.key.address.toLowerCase()) {
            throw new ContractError(`You are not the owner of agent ${agentId}. Owner: ${owner}`);
        }
        let newCardUri;
        if (hasCardChanges && !opts.uri && tokenUri) {
            if (opts.dryRun) {
                // Skip external calls (IPFS fetch, image upload, service checks) in dryRun
                newCardUri = "ipfs://dry-run-placeholder";
            }
            else {
                let existingCard;
                try {
                    existingCard = await fetchAgentCard(tokenUri, this.config.ipfsGateway);
                }
                catch (firstError) {
                    this.callbacks.onWarning?.(`Failed to fetch agent card, retrying... (${firstError instanceof Error ? firstError.message : String(firstError)})`);
                    try {
                        existingCard = await fetchAgentCard(tokenUri, this.config.ipfsGateway);
                    }
                    catch {
                        if (opts.allowFreshCard) {
                            existingCard = generateAgentCard({
                                name: `Agent ${agentId}`, type: "other",
                                builderCode: "", operatorAddress: "",
                                chainId: this.config.chainId,
                            });
                        }
                        else {
                            throw new AgentSdkError(`Could not fetch existing agent card for Agent #${agentId}. ` +
                                "Set allowFreshCard: true to proceed with a fresh card, " +
                                "or provide all card fields explicitly.");
                        }
                    }
                }
                const [resolvedImage] = await Promise.all([
                    opts.image ? this.resolveImage(opts.image) : Promise.resolve(undefined),
                    opts.services?.length ? this.checkServices(opts.services.map(s => s.endpoint)) : Promise.resolve(),
                ]);
                const mergedCard = mergeAgentCard(existingCard, {
                    name: opts.name,
                    type: opts.type,
                    description: opts.description,
                    services: opts.services,
                    removeServices: opts.removeServices,
                    image: resolvedImage,
                    x402: opts.x402,
                    actions: opts.actions,
                    active: opts.active,
                    supportedTrust: opts.supportedTrust,
                    tags: opts.tags,
                    version: opts.version,
                    license: opts.license,
                    sourceCode: opts.sourceCode,
                    documentation: opts.documentation,
                });
                if (!this.storage)
                    throw new StorageError("No storage provider configured. Provide a uri or configure a StorageProvider.");
                this.callbacks.onProgress?.("Uploading updated agent card to IPFS...");
                newCardUri = await this.storage.uploadJSON(mergedCard, mergedCard.name);
            }
        }
        // Fetch gas price once and reuse for all transactions in this call.
        const gasPrice = opts.gasPrice ? opts.gasPrice * BigInt(1e9) : await resolveGasPrice(publicClient);
        this.callbacks.onProgress?.(`Using gas price: ${gasPrice / BigInt(1e9)} gwei`);
        const startMs = Date.now();
        const simBaseParams = { ...contractArgs, abi: identityRegistry.abi, account: this.clients.account };
        const plannedWrites = [];
        if (opts.builderCode) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "builderCode", encodeStringMetadata(opts.builderCode)], field: "builderCode" });
        }
        if (opts.type) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "agentType", encodeStringMetadata(opts.type)], field: "agentType" });
        }
        if (opts.version) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "version", encodeStringMetadata(opts.version)], field: "version" });
        }
        if (opts.license) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "license", encodeStringMetadata(opts.license)], field: "license" });
        }
        if (opts.sourceCode) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "sourceCode", encodeStringMetadata(opts.sourceCode)], field: "sourceCode" });
        }
        if (opts.documentation) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "documentation", encodeStringMetadata(opts.documentation)], field: "documentation" });
        }
        if (opts.tags && opts.tags.length > 0) {
            plannedWrites.push({ functionName: "setMetadata", args: [agentId, "tags", encodeStringMetadata(JSON.stringify(opts.tags))], field: "tags" });
        }
        const effectiveUri = opts.uri ?? newCardUri;
        if (effectiveUri) {
            plannedWrites.push({ functionName: "setAgentURI", args: [agentId, effectiveUri], field: "tokenURI" });
        }
        if (opts.wallet) {
            if (opts.wallet.toLowerCase() !== this.key.address.toLowerCase()) {
                throw new ValidationError(`Wallet linkage requires the wallet's private key. Currently only self-signing is supported (wallet must match signer ${this.key.address}).`);
            }
            const deadline = walletLinkDeadline();
            const sig = await signWalletLink({
                agentId, wallet: opts.wallet, ownerAddress: this.key.address, deadline,
                account: this.key.account, chainId: this.config.chainId,
                contractAddress: this.config.identityRegistry,
            });
            plannedWrites.push({ functionName: "setAgentWallet", args: [agentId, opts.wallet, deadline, sig], field: "wallet", gas: 300000n });
        }
        const updatedFields = plannedWrites.map(w => w.field);
        if (opts.active !== undefined)
            updatedFields.push("active");
        const updateAuditArgs = { agentId: String(agentId), fields: updatedFields };
        const writeAuditArgs = plannedWrites.map(w => AuditLogger.sanitizeArgs(w.functionName, w.args));
        try {
            const simulations = await Promise.all(plannedWrites.map(w => simulateOnly(publicClient, {
                ...simBaseParams, functionName: w.functionName, args: w.args, gasPrice, gas: w.gas,
            }, this.callbacks)));
            for (let i = 0; i < simulations.length; i++) {
                this.audit.log({ event: "tx:simulate", ...this.auditBase, method: simulations[i].method, args: writeAuditArgs[i],
                    simulation: { passed: true, gasEstimate: String(simulations[i].gasEstimate) }, durationMs: Date.now() - startMs });
            }
            if (opts.dryRun) {
                return { agentId, updatedFields, txHashes: [], simulations: simulations.map(s => ({ method: s.method, gasEstimate: s.gasEstimate })) };
            }
            let nonce = await publicClient.getTransactionCount({ address: this.key.address, blockTag: "pending" });
            const txHashes = [];
            for (let i = 0; i < plannedWrites.length; i++) {
                const write = plannedWrites[i];
                // Use simulation estimate + 20% buffer to avoid over-reserving gas at high gas prices.
                const gasLimit = simulations[i].gasEstimate > 0n
                    ? simulations[i].gasEstimate * 12n / 10n
                    : (write.gas ?? 300000n);
                this.callbacks.onProgress?.(`Broadcasting ${write.functionName}...`);
                const hash = await writeContractDirect({
                    publicClient, account, chainId: this.config.chainId,
                    address: contractArgs.address, abi: identityRegistry.abi,
                    functionName: write.functionName, args: write.args,
                    nonce: nonce++, gasPrice, gas: gasLimit,
                    rpcUrl: this.config.rpcUrl,
                });
                txHashes.push(hash);
                this.audit.log({ event: "tx:broadcast", ...this.auditBase, method: write.functionName, args: writeAuditArgs[i],
                    simulation: { passed: true, gasEstimate: String(simulations[i].gasEstimate) },
                    durationMs: Date.now() - startMs, result: { txHash: hash } });
            }
            const receipts = await Promise.all(txHashes.map(hash => publicClient.waitForTransactionReceipt({ hash })));
            for (let i = 0; i < receipts.length; i++) {
                assertReceiptSuccess(receipts[i], `update.${plannedWrites[i].functionName}`, txHashes[i]);
                this.audit.log({ event: "tx:confirm", ...this.auditBase, method: plannedWrites[i].functionName, args: writeAuditArgs[i], durationMs: Date.now() - startMs, result: { txHash: txHashes[i], gasUsed: String(receipts[i].gasUsed), blockNumber: String(receipts[i].blockNumber) } });
            }
            // Match by purpose ('field') rather than ABI function name so a future
            // contract rename of setAgentWallet doesn't silently break this lookup.
            const walletWriteIdx = plannedWrites.findIndex(w => w.field === "wallet");
            const walletTxHash = walletWriteIdx >= 0 ? txHashes[walletWriteIdx] : undefined;
            return { agentId, updatedFields, txHashes, walletTxHash };
        }
        catch (error) {
            if (error instanceof SimulationError || error instanceof AgentSdkError) {
                this.audit.log({ event: "tx:fail", ...this.auditBase, method: "update", args: updateAuditArgs, durationMs: Date.now() - startMs, error: { code: error.name, message: error.message } });
                throw error;
            }
            const formatted = formatContractError(error);
            this.audit.log({ event: "tx:fail", ...this.auditBase, method: "update", args: updateAuditArgs, durationMs: Date.now() - startMs, error: { code: formatted.name, message: formatted.message } });
            throw formatted;
        }
    }
    async giveFeedback(opts) {
        const valueDecimals = opts.valueDecimals ?? 0;
        if (valueDecimals < VALIDATION_LIMITS.VALUE_DECIMALS_MIN || valueDecimals > VALIDATION_LIMITS.VALUE_DECIMALS_MAX || !Number.isInteger(valueDecimals)) {
            throw new ValidationError(`valueDecimals must be an integer between ${VALIDATION_LIMITS.VALUE_DECIMALS_MIN} and ${VALIDATION_LIMITS.VALUE_DECIMALS_MAX}.`);
        }
        validateStringField(opts.tag1, "tag1", VALIDATION_LIMITS.TAG_MAX_BYTES, false);
        validateStringField(opts.tag2, "tag2", VALIDATION_LIMITS.TAG_MAX_BYTES, false);
        validateStringField(opts.endpoint, "endpoint", VALIDATION_LIMITS.ENDPOINT_MAX_BYTES, false);
        validateStringField(opts.feedbackURI, "feedbackURI", VALIDATION_LIMITS.FEEDBACK_URI_MAX_BYTES, false);
        const { publicClient, account } = this.clients;
        const { agentId, value } = opts;
        const tag1 = opts.tag1 ?? "";
        const tag2 = opts.tag2 ?? "";
        const endpoint = opts.endpoint ?? "";
        const feedbackURI = opts.feedbackURI ?? "";
        const feedbackHash = opts.feedbackHash ?? `0x${"0".repeat(64)}`;
        const gasPrice = opts.gasPrice ? opts.gasPrice * BigInt(1e9) : await resolveGasPrice(publicClient);
        const startMs = Date.now();
        const args = [agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash];
        const auditArgs = AuditLogger.sanitizeArgs("giveFeedback", args);
        const baseParams = {
            address: this.config.reputationRegistry,
            abi: ReputationRegistryABI,
            functionName: "giveFeedback",
            args: args,
            account,
            gasPrice,
        };
        if (opts.dryRun) {
            const sim = await simulateOnly(publicClient, baseParams, this.callbacks);
            return { txHash: `0x${"0".repeat(64)}`, agentId, feedbackIndex: 0n, gasEstimate: sim.gasEstimate };
        }
        try {
            const sim = await simulateOnly(publicClient, baseParams, this.callbacks);
            this.audit.log({ event: "tx:simulate", ...this.reputationAuditBase, method: "giveFeedback", args: auditArgs,
                simulation: { passed: true, gasEstimate: String(sim.gasEstimate) }, durationMs: Date.now() - startMs });
            const feedbackNonce = await publicClient.getTransactionCount({ address: this.key.address, blockTag: "pending" });
            const feedbackGasLimit = sim.gasEstimate > 0n ? sim.gasEstimate * 12n / 10n : 300000n;
            this.callbacks.onProgress?.("Broadcasting giveFeedback...");
            const hash = await writeContractDirect({
                publicClient, account, chainId: this.config.chainId,
                address: baseParams.address, abi: baseParams.abi,
                functionName: "giveFeedback", args: [...args],
                nonce: feedbackNonce, gasPrice, gas: feedbackGasLimit,
                rpcUrl: this.config.rpcUrl,
            });
            this.audit.log({ event: "tx:broadcast", ...this.reputationAuditBase, method: "giveFeedback", args: auditArgs,
                simulation: { passed: true, gasEstimate: String(sim.gasEstimate) },
                durationMs: Date.now() - startMs, result: { txHash: hash } });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            assertReceiptSuccess(receipt, "giveFeedback", hash);
            const registryAddr = this.config.reputationRegistry.toLowerCase();
            const feedbackLog = receipt.logs.find((log) => log.address.toLowerCase() === registryAddr
                && log.topics[0] === NEW_FEEDBACK_EVENT_TOPIC);
            if (!feedbackLog)
                throw new ContractError("Failed to extract feedbackIndex from giveFeedback transaction.");
            const decoded = decodeEventLog({
                abi: ReputationRegistryABI,
                data: feedbackLog.data,
                topics: feedbackLog.topics,
            });
            const feedbackIndex = BigInt(decoded.args.feedbackIndex);
            this.audit.log({ event: "tx:confirm", ...this.reputationAuditBase, method: "giveFeedback", args: auditArgs, durationMs: Date.now() - startMs, result: { txHash: hash, gasUsed: String(receipt.gasUsed), blockNumber: String(receipt.blockNumber) } });
            return { txHash: hash, agentId, feedbackIndex };
        }
        catch (error) {
            if (error instanceof SimulationError || error instanceof AgentSdkError) {
                this.audit.log({ event: "tx:fail", ...this.reputationAuditBase, method: "giveFeedback", args: auditArgs, durationMs: Date.now() - startMs, error: { code: error.name, message: error.message } });
                throw error;
            }
            const formatted = formatContractError(error);
            this.audit.log({ event: "tx:fail", ...this.reputationAuditBase, method: "giveFeedback", args: auditArgs, durationMs: Date.now() - startMs, error: { code: formatted.name, message: formatted.message } });
            throw formatted;
        }
    }
    async revokeFeedback(opts) {
        const { publicClient, account } = this.clients;
        const { agentId, feedbackIndex } = opts;
        const gasPrice = opts.gasPrice ? opts.gasPrice * BigInt(1e9) : await resolveGasPrice(publicClient);
        const startMs = Date.now();
        const auditArgs = AuditLogger.sanitizeArgs("revokeFeedback", [agentId, feedbackIndex]);
        const baseParams = {
            address: this.config.reputationRegistry,
            abi: ReputationRegistryABI,
            functionName: "revokeFeedback",
            args: [agentId, feedbackIndex],
            account,
            gasPrice,
        };
        if (opts.dryRun) {
            const sim = await simulateOnly(publicClient, baseParams, this.callbacks);
            return { txHash: `0x${"0".repeat(64)}`, agentId, gasEstimate: sim.gasEstimate };
        }
        try {
            const sim = await simulateOnly(publicClient, baseParams, this.callbacks);
            this.audit.log({ event: "tx:simulate", ...this.reputationAuditBase, method: "revokeFeedback", args: auditArgs,
                simulation: { passed: true, gasEstimate: String(sim.gasEstimate) }, durationMs: Date.now() - startMs });
            const revokeNonce = await publicClient.getTransactionCount({ address: this.key.address, blockTag: "pending" });
            const revokeGasLimit = sim.gasEstimate > 0n ? sim.gasEstimate * 12n / 10n : 200000n;
            this.callbacks.onProgress?.("Broadcasting revokeFeedback...");
            const hash = await writeContractDirect({
                publicClient, account, chainId: this.config.chainId,
                address: baseParams.address, abi: baseParams.abi,
                functionName: "revokeFeedback", args: [agentId, feedbackIndex],
                nonce: revokeNonce, gasPrice, gas: revokeGasLimit,
                rpcUrl: this.config.rpcUrl,
            });
            this.audit.log({ event: "tx:broadcast", ...this.reputationAuditBase, method: "revokeFeedback", args: auditArgs,
                simulation: { passed: true, gasEstimate: String(sim.gasEstimate) },
                durationMs: Date.now() - startMs, result: { txHash: hash } });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            assertReceiptSuccess(receipt, "revokeFeedback", hash);
            this.audit.log({ event: "tx:confirm", ...this.reputationAuditBase, method: "revokeFeedback", args: auditArgs, durationMs: Date.now() - startMs, result: { txHash: hash, gasUsed: String(receipt.gasUsed), blockNumber: String(receipt.blockNumber) } });
            return { txHash: hash, agentId };
        }
        catch (error) {
            if (error instanceof SimulationError || error instanceof AgentSdkError) {
                this.audit.log({ event: "tx:fail", ...this.reputationAuditBase, method: "revokeFeedback", args: auditArgs, durationMs: Date.now() - startMs, error: { code: error.name, message: error.message } });
                throw error;
            }
            const formatted = formatContractError(error);
            this.audit.log({ event: "tx:fail", ...this.reputationAuditBase, method: "revokeFeedback", args: auditArgs, durationMs: Date.now() - startMs, error: { code: formatted.name, message: formatted.message } });
            throw formatted;
        }
    }
    async getStatus(agentId) {
        return this.readClient.getStatus(agentId);
    }
    async resolveImage(imageInput) {
        if (imageInput.startsWith("ipfs://") || imageInput.startsWith("https://") || imageInput.startsWith("http://")) {
            return imageInput;
        }
        if (!this.storage?.uploadFile) {
            this.callbacks.onWarning?.("Cannot upload image — no storage provider with file upload configured. Registering without image.");
            return "";
        }
        const { readFile } = await import("node:fs/promises");
        const { extname, basename } = await import("node:path");
        const ext = extname(imageInput).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
            throw new ValidationError(`Unsupported image type "${ext}". Must be one of: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}.`);
        }
        const content = await readFile(imageInput).catch(() => {
            throw new StorageError(`Image file not found: ${imageInput}`);
        });
        if (content.byteLength > MAX_IMAGE_SIZE) {
            this.callbacks.onWarning?.(`Image file exceeds 2MB limit (${(content.byteLength / 1024 / 1024).toFixed(1)}MB). Registering without image.`);
            return "";
        }
        this.callbacks.onProgress?.("Uploading image to IPFS...");
        return this.storage.uploadFile(content, basename(imageInput), MIME_TYPES[ext]);
    }
    async checkServices(urls) {
        const warnings = await Promise.all(urls.map(url => checkServiceReachability(url)));
        for (const warning of warnings) {
            if (warning)
                this.callbacks.onWarning?.(warning);
        }
    }
}
//# sourceMappingURL=client.js.map