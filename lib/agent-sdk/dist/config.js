import { AgentSdkError } from "./errors.js";
import { DEFAULT_IPFS_GATEWAY } from "./card.js";
/** Staging: Injective's own early deployment on testnet (chain 1439).
 *  Original contract set with existing registered agents. */
export const STAGING = {
    name: "staging",
    chainId: 1439,
    rpcUrl: "https://testnet.sentry.chain.json-rpc.injective.network",
    identityRegistry: "0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e",
    reputationRegistry: "0x019b24a73d493d86c61cc5dfea32e4865eecb922",
    validationRegistry: "0xbd84e152f41e28d92437b4b822b77e7e31bfd2a4",
    ipfsGateway: DEFAULT_IPFS_GATEWAY,
    deployBlock: 119354199n,
};
/** Testnet: Canonical ERC-8004 contracts on Injective testnet (chain 1439). */
export const TESTNET = {
    name: "testnet",
    chainId: 1439,
    rpcUrl: "https://testnet.sentry.chain.json-rpc.injective.network",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    validationRegistry: "0x0000000000000000000000000000000000000000",
    ipfsGateway: DEFAULT_IPFS_GATEWAY,
    deployBlock: 120790000n,
};
/** Mainnet: Canonical ERC-8004 contracts on Injective mainnet (chain 1776). */
export const MAINNET = {
    name: "mainnet",
    chainId: 1776,
    rpcUrl: "https://sentry.evm-rpc.injective.network/",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    validationRegistry: "0x0000000000000000000000000000000000000000",
    ipfsGateway: DEFAULT_IPFS_GATEWAY,
    deployBlock: 162000000n,
};
const NETWORKS = { staging: STAGING, testnet: TESTNET, mainnet: MAINNET };
export function resolveNetworkConfig(opts) {
    const network = opts?.network ?? "testnet";
    const base = NETWORKS[network];
    if (!base) {
        throw new AgentSdkError(`Unknown network: "${network}". Use "staging", "testnet", or "mainnet".`);
    }
    return opts?.rpcUrl ? { ...base, rpcUrl: opts.rpcUrl } : base;
}
//# sourceMappingURL=config.js.map