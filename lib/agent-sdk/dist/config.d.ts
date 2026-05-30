import type { NetworkConfig } from "./types.js";
/** Staging: Injective's own early deployment on testnet (chain 1439).
 *  Original contract set with existing registered agents. */
export declare const STAGING: NetworkConfig;
/** Testnet: Canonical ERC-8004 contracts on Injective testnet (chain 1439). */
export declare const TESTNET: NetworkConfig;
/** Mainnet: Canonical ERC-8004 contracts on Injective mainnet (chain 1776). */
export declare const MAINNET: NetworkConfig;
export declare function resolveNetworkConfig(opts?: {
    network?: string;
    rpcUrl?: string;
}): NetworkConfig;
