import { resolveNetworkConfig } from "./config.js";
import { createReadOnlyClients, decodeStringMetadata, identityTuple, ReputationRegistryABI } from "./contracts.js";
import { fetchAgentCard } from "./card.js";
import { AgentSdkError, formatContractError } from "./errors.js";
import { parseAbiItem } from "viem";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const DEFAULT_CHUNK_SIZE = 10_000;
const DEFAULT_CACHE_TTL = 60_000;
export class AgentReadClient {
    config;
    publicClient;
    identityRegistry;
    reputationRegistry;
    // Discovery cache with incremental scan support
    cachedMinted = new Set();
    cachedBurned = new Set();
    lastScannedBlock = null;
    cacheTimestamp = 0;
    discoverPromise = null;
    constructor(opts) {
        this.config = resolveNetworkConfig({ network: opts?.network, rpcUrl: opts?.rpcUrl });
        const { publicClient, identityRegistry, reputationRegistry } = createReadOnlyClients(this.config);
        this.publicClient = publicClient;
        this.identityRegistry = identityRegistry;
        this.reputationRegistry = reputationRegistry;
    }
    // ─── Single Agent ──────────────────────────────────────────────────
    async getContractData(agentId) {
        const contractArgs = { address: this.config.identityRegistry, abi: this.identityRegistry.abi };
        const [owner, tokenUri, wallet, builderCodeRaw, typeRaw] = await Promise.all([
            this.publicClient.readContract({ ...contractArgs, functionName: "ownerOf", args: [agentId] }),
            this.publicClient.readContract({ ...contractArgs, functionName: "tokenURI", args: [agentId] }),
            this.publicClient.readContract({ ...contractArgs, functionName: "getAgentWallet", args: [agentId] }),
            this.publicClient.readContract({ ...contractArgs, functionName: "getMetadata", args: [agentId, "builderCode"] }),
            this.publicClient.readContract({ ...contractArgs, functionName: "getMetadata", args: [agentId, "agentType"] }),
        ]);
        return {
            owner, tokenUri, wallet,
            builderCode: decodeStringMetadata(builderCodeRaw),
            agentType: decodeStringMetadata(typeRaw),
        };
    }
    async getStatus(agentId) {
        try {
            const { owner, tokenUri, wallet, builderCode, agentType } = await this.getContractData(agentId);
            let name = `Agent ${agentId}`;
            try {
                const card = await fetchAgentCard(tokenUri, this.config.ipfsGateway);
                name = card.name;
            }
            catch (err) {
                console.warn(`[AgentSDK] Failed to fetch card for agent ${agentId}:`, err instanceof Error ? err.message : String(err));
            }
            return {
                agentId, name, type: agentType, owner, wallet, builderCode, tokenUri,
                identityTuple: identityTuple(this.config, agentId),
            };
        }
        catch (error) {
            if (error instanceof AgentSdkError)
                throw error;
            throw formatContractError(error);
        }
    }
    async fetchCard(uri) {
        return fetchAgentCard(uri, this.config.ipfsGateway);
    }
    async ping() {
        try {
            await this.publicClient.getBlockNumber();
            return true;
        }
        catch {
            return false;
        }
    }
    async pingDetailed() {
        const start = Date.now();
        try {
            const blockNumber = await this.publicClient.getBlockNumber();
            return { reachable: true, blockNumber, latencyMs: Date.now() - start };
        }
        catch {
            return { reachable: false, latencyMs: Date.now() - start };
        }
    }
    // ─── Discovery ─────────────────────────────────────────────────────
    async discoverAgentIds(opts) {
        const cacheTtl = opts?.cacheTtl ?? DEFAULT_CACHE_TTL;
        // Explicit fromBlock bypasses cache entirely
        if (opts?.fromBlock) {
            return this.scanBlocks(opts.fromBlock, opts.chunkSize);
        }
        // Return cached if fresh
        if (this.lastScannedBlock && Date.now() - this.cacheTimestamp < cacheTtl) {
            return this.getLiveIds();
        }
        // Deduplicate concurrent calls
        if (this.discoverPromise)
            return this.discoverPromise;
        this.discoverPromise = this.refreshCache(opts?.chunkSize).finally(() => {
            this.discoverPromise = null;
        });
        return this.discoverPromise;
    }
    async refreshCache(chunkSize) {
        const fromBlock = this.lastScannedBlock ? this.lastScannedBlock + 1n : this.config.deployBlock;
        const latestBlock = await this.publicClient.getBlockNumber();
        if (fromBlock <= latestBlock) {
            await this.scanBlockRange(fromBlock, latestBlock, chunkSize ?? DEFAULT_CHUNK_SIZE);
            this.lastScannedBlock = latestBlock;
        }
        this.cacheTimestamp = Date.now();
        return this.getLiveIds();
    }
    async scanBlocks(fromBlock, chunkSize) {
        const latestBlock = await this.publicClient.getBlockNumber();
        const minted = new Set();
        const burned = new Set();
        const size = chunkSize ?? DEFAULT_CHUNK_SIZE;
        for (let start = fromBlock; start <= latestBlock; start += BigInt(size)) {
            const end = start + BigInt(size) - 1n > latestBlock ? latestBlock : start + BigInt(size) - 1n;
            const logs = await this.publicClient.getLogs({
                address: this.config.identityRegistry, event: TRANSFER_EVENT,
                fromBlock: start, toBlock: end,
            });
            for (const log of logs) {
                if (log.args.from === ZERO_ADDRESS)
                    minted.add(log.args.tokenId);
                if (log.args.to === ZERO_ADDRESS)
                    burned.add(log.args.tokenId);
            }
        }
        return [...minted].filter(id => !burned.has(id)).sort((a, b) => Number(a - b));
    }
    async scanBlockRange(fromBlock, toBlock, chunkSize) {
        for (let start = fromBlock; start <= toBlock; start += BigInt(chunkSize)) {
            const end = start + BigInt(chunkSize) - 1n > toBlock ? toBlock : start + BigInt(chunkSize) - 1n;
            const logs = await this.publicClient.getLogs({
                address: this.config.identityRegistry, event: TRANSFER_EVENT,
                fromBlock: start, toBlock: end,
            });
            for (const log of logs) {
                if (log.args.from === ZERO_ADDRESS)
                    this.cachedMinted.add(log.args.tokenId);
                if (log.args.to === ZERO_ADDRESS)
                    this.cachedBurned.add(log.args.tokenId);
            }
        }
    }
    getLiveIds() {
        return [...this.cachedMinted].filter(id => !this.cachedBurned.has(id)).sort((a, b) => Number(a - b));
    }
    // ─── Listing & Pagination ──────────────────────────────────────────
    async listAgents(opts) {
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? 50;
        const allIds = await this.discoverAgentIds();
        const total = allIds.length;
        const pageIds = allIds.slice(offset, offset + limit);
        const results = await Promise.allSettled(pageIds.map(id => opts?.enrich ? this.getEnrichedAgent(id) : this.getStatus(id)));
        const agents = [];
        const failed = [];
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === "fulfilled") {
                agents.push(results[i].value);
            }
            else {
                failed.push(pageIds[i]);
            }
        }
        return { agents, total, offset, limit, failed };
    }
    // ─── Query by Owner ────────────────────────────────────────────────
    async getAgentsByOwner(address, opts) {
        const allIds = await this.discoverAgentIds();
        const contractArgs = { address: this.config.identityRegistry, abi: this.identityRegistry.abi };
        const ownerResults = await Promise.allSettled(allIds.map(id => this.publicClient.readContract({ ...contractArgs, functionName: "ownerOf", args: [id] })));
        const ownedIds = allIds.filter((_, i) => {
            const result = ownerResults[i];
            return result.status === "fulfilled" && result.value.toLowerCase() === address.toLowerCase();
        });
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? 50;
        const pageIds = ownedIds.slice(offset, offset + limit);
        const results = await Promise.allSettled(pageIds.map(id => this.getStatus(id)));
        const agents = [];
        const failed = [];
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === "fulfilled") {
                agents.push(results[i].value);
            }
            else {
                failed.push(pageIds[i]);
            }
        }
        return { agents, total: ownedIds.length, offset, limit, failed };
    }
    // ─── Reputation ────────────────────────────────────────────────────
    async getReputation(agentId, opts) {
        const [clients, entries] = await Promise.all([
            this.getClients(agentId),
            this.getFeedbackEntries(agentId, opts),
        ]);
        const active = entries.filter(e => !e.revoked);
        if (active.length === 0)
            return { score: 0, count: 0, clients };
        const total = active.reduce((sum, e) => sum + Number(e.value) / Math.pow(10, e.decimals), 0);
        const score = Math.round((total / active.length) * 100) / 100;
        return { score, count: active.length, clients };
    }
    async getFeedbackEntries(agentId, opts) {
        const repArgs = { address: this.config.reputationRegistry, abi: ReputationRegistryABI };
        const result = await this.publicClient.readContract({
            ...repArgs,
            functionName: "readAllFeedback",
            args: [agentId, opts?.clientAddresses ?? [], opts?.tag1 ?? "", opts?.tag2 ?? "", opts?.includeRevoked ?? false],
        });
        const [clients, feedbackIndexes, values, valueDecimals, tag1s, tag2s, revokedStatuses] = result;
        return clients.map((client, i) => ({
            client,
            feedbackIndex: feedbackIndexes[i],
            value: values[i],
            decimals: Number(valueDecimals[i]),
            tags: [tag1s[i], tag2s[i]],
            revoked: revokedStatuses[i],
        }));
    }
    async getClients(agentId) {
        return await this.publicClient.readContract({
            address: this.config.reputationRegistry,
            abi: ReputationRegistryABI,
            functionName: "getClients",
            args: [agentId],
        });
    }
    // ─── Enriched ──────────────────────────────────────────────────────
    async getEnrichedAgent(agentId) {
        let contractData;
        try {
            contractData = await this.getContractData(agentId);
        }
        catch (error) {
            if (error instanceof AgentSdkError)
                throw error;
            throw formatContractError(error);
        }
        const [card, reputation] = await Promise.all([
            fetchAgentCard(contractData.tokenUri, this.config.ipfsGateway).catch((err) => {
                console.warn(`[AgentSDK] Failed to fetch card for agent ${agentId}:`, err instanceof Error ? err.message : String(err));
                return null;
            }),
            this.getReputation(agentId),
        ]);
        return {
            agentId, name: card?.name ?? `Agent ${agentId}`,
            type: contractData.agentType, owner: contractData.owner,
            wallet: contractData.wallet, builderCode: contractData.builderCode,
            tokenUri: contractData.tokenUri,
            identityTuple: identityTuple(this.config, agentId),
            reputation, card,
        };
    }
    // ─── Event Watching ────────────────────────────────────────────────
    watchRegistrations(callback) {
        return this.publicClient.watchEvent({
            address: this.config.identityRegistry,
            event: TRANSFER_EVENT,
            args: { from: ZERO_ADDRESS },
            onLogs: (logs) => {
                for (const log of logs) {
                    callback({ agentId: log.args.tokenId, owner: log.args.to, txHash: log.transactionHash });
                }
            },
        });
    }
    watchDeregistrations(callback) {
        return this.publicClient.watchEvent({
            address: this.config.identityRegistry,
            event: TRANSFER_EVENT,
            args: { to: ZERO_ADDRESS },
            onLogs: (logs) => {
                for (const log of logs) {
                    callback({ agentId: log.args.tokenId, previousOwner: log.args.from, txHash: log.transactionHash });
                }
            },
        });
    }
}
//# sourceMappingURL=read-client.js.map