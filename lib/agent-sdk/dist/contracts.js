import { createPublicClient, createWalletClient, http, custom, getContract, encodeAbiParameters, decodeAbiParameters, parseAbiParameters, encodeFunctionData } from "viem";
/**
 * Injective's EVM RPC returns 0 for eth_getBalance even when the account has a
 * non-zero native bank balance. viem's writeContract does a client-side preflight
 * check using eth_getBalance and aborts with "total cost exceeds balance" before
 * the transaction ever reaches the node — which enforces the real balance check.
 *
 * This transport wraps every RPC call normally, but when eth_getBalance returns
 * 0x0 it substitutes a 10 INJ placeholder so the preflight passes. The node
 * still validates the actual bank balance when it receives eth_sendRawTransaction.
 */
async function rpcFetch(url, method, params) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} from ${url}`);
    const body = await res.json();
    if (body.error) {
        const err = new Error(body.error.message);
        err.code = body.error.code;
        throw err;
    }
    return body.result;
}
function createInjectiveTransport(url) {
    return custom({
        async request({ method, params }) {
            const result = await rpcFetch(url, method, params ?? []);
            if (method === "eth_getBalance" && (result === "0x0" || result === "0x" || !result)) {
                // Return 10 INJ as a placeholder balance for the preflight check.
                // The real bank balance is validated by the node on broadcast.
                return "0x8AC7230489E80000";
            }
            return result;
        },
    });
}
import IdentityRegistryABI from "./abi/IdentityRegistry.json" with { type: "json" };
import ReputationRegistryABI from "./abi/ReputationRegistry.json" with { type: "json" };
export { IdentityRegistryABI, ReputationRegistryABI };
function makeChain(config) {
    return {
        id: config.chainId,
        name: config.name,
        nativeCurrency: { name: "INJ", symbol: "INJ", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
    };
}
export function createClients(config, account) {
    const chain = makeChain(config);
    const transport = createInjectiveTransport(config.rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ chain, account, transport });
    const identityRegistry = getContract({
        address: config.identityRegistry,
        abi: IdentityRegistryABI,
        client: { public: publicClient, wallet: walletClient },
    });
    return { publicClient, walletClient, identityRegistry, account };
}
export function createReadOnlyClients(config) {
    const chain = makeChain(config);
    const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    const identityRegistry = getContract({
        address: config.identityRegistry,
        abi: IdentityRegistryABI,
        client: { public: publicClient },
    });
    const reputationRegistry = getContract({
        address: config.reputationRegistry,
        abi: ReputationRegistryABI,
        client: { public: publicClient },
    });
    return { publicClient, identityRegistry, reputationRegistry };
}
export function encodeStringMetadata(value) {
    return encodeAbiParameters(parseAbiParameters("string"), [value]);
}
/**
 * Sign and broadcast a contract write without viem's preflight balance check.
 *
 * viem's writeContract calls prepareTransactionRequest → assertRequest which
 * checks eth_getBalance before sending. On Injective mainnet, eth_getBalance
 * returns 0 even when the account has a non-zero bank balance, causing a false
 * "total cost exceeds balance" rejection before the transaction ever reaches
 * the node.
 *
 * This helper bypasses that check by going directly:
 *   encodeFunctionData → account.signTransaction → eth_sendRawTransaction
 */
export async function writeContractDirect(params) {
    const data = encodeFunctionData({
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
    });
    // Injective mainnet requires EIP-1559 (type-2) transactions.
    // Setting maxFeePerGas = maxPriorityFeePerGas = gasPrice gives us
    // predictable fee behaviour equivalent to a legacy transaction.
    //
    // We sign + sendRawTransaction directly (bypassing walletClient.writeContract)
    // to avoid viem's client-side eth_getBalance preflight, which returns 0 on
    // Injective's EVM RPC even when the bank balance is non-zero.
    const signedTx = await params.account.signTransaction({
        to: params.address,
        data,
        gas: params.gas,
        maxFeePerGas: params.gasPrice,
        maxPriorityFeePerGas: params.gasPrice,
        nonce: params.nonce,
        chainId: params.chainId,
        value: params.value ?? 0n,
        type: "eip1559",
    });
    // Send via raw JSON-RPC fetch, bypassing viem's client-side checks entirely.
    const rpcUrl = params.rpcUrl ?? params.publicClient.transport?.url;
    if (rpcUrl) {
        const body = JSON.stringify({
            jsonrpc: "2.0", id: Date.now(),
            method: "eth_sendRawTransaction",
            params: [signedTx],
        });
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const json = await res.json();
        if (json.error) {
            const detail = json.error.data ? ` (data: ${json.error.data})` : "";
            throw new Error(`eth_sendRawTransaction failed [${json.error.code}]: ${json.error.message}${detail}\n` +
                `  tx prefix: ${signedTx.slice(0, 12)}... len: ${signedTx.length}\n` +
                `  nonce: ${params.nonce}, chainId: ${params.chainId}, gas: ${params.gas}, gasPrice: ${params.gasPrice}`);
        }
        return json.result;
    }
    return params.publicClient.sendRawTransaction({ serializedTransaction: signedTx });
}
export function decodeStringMetadata(raw) {
    if (!raw || raw === "0x")
        return "";
    return decodeAbiParameters(parseAbiParameters("string"), raw)[0];
}
export function identityTuple(config, agentId) {
    return `eip155:${config.chainId}:${config.identityRegistry}:${agentId}`;
}
// Must match IdentityRegistryUpgradeable.sol MAX_DEADLINE_DELAY (5 minutes)
export const MAX_DEADLINE_SECONDS = 300;
export function walletLinkDeadline(offsetSeconds = 240) {
    if (offsetSeconds > MAX_DEADLINE_SECONDS) {
        throw new Error(`walletLinkDeadline: offsetSeconds (${offsetSeconds}) exceeds contract maximum (${MAX_DEADLINE_SECONDS})`);
    }
    return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}
//# sourceMappingURL=contracts.js.map