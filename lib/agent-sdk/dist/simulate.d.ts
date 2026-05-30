import type { AgentClientCallbacks } from "./types.js";
export interface SimulationResult {
    method: string;
    gasEstimate: bigint;
    result: unknown;
}
/**
 * Simulate a contract call without broadcasting. Throws SimulationError on revert.
 */
export declare function simulateOnly(publicClient: {
    simulateContract: (args: any) => Promise<any>;
    estimateContractGas: (args: any) => Promise<bigint>;
}, params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args: readonly unknown[];
    account: unknown;
    gasPrice?: bigint;
    gas?: bigint;
}, callbacks?: AgentClientCallbacks): Promise<SimulationResult>;
/**
 * Convenience helper: simulate then broadcast in one call.
 * Exported for consumers building custom contract interactions.
 * Not used internally — the SDK calls simulateOnly + writeContract
 * separately to capture gasEstimate for audit logging.
 */
export declare function simulateAndWrite(publicClient: {
    simulateContract: (args: any) => Promise<any>;
    estimateContractGas: (args: any) => Promise<bigint>;
}, walletClient: {
    writeContract: (args: any) => Promise<`0x${string}`>;
}, params: {
    address: `0x${string}`;
    abi: unknown[];
    functionName: string;
    args: readonly unknown[];
    account: unknown;
    nonce?: number;
    gasPrice?: bigint;
    gas?: bigint;
}, callbacks?: AgentClientCallbacks): Promise<`0x${string}`>;
