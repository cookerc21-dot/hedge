import { BaseError } from "viem";
export declare class AgentSdkError extends Error {
    constructor(message: string);
}
export declare class ValidationError extends AgentSdkError {
    constructor(message: string);
}
export declare class ContractError extends AgentSdkError {
    readonly revertReason: string | undefined;
    constructor(message: string, revertReason?: string);
}
export declare class StorageError extends AgentSdkError {
    constructor(message: string);
}
export declare class SimulationError extends AgentSdkError {
    readonly revertReason: string | undefined;
    readonly gasEstimate: bigint | undefined;
    constructor(message: string, revertReason?: string, gasEstimate?: bigint);
}
export declare function extractRevertName(error: BaseError): string | undefined;
/**
 * Asserts a viem transaction receipt landed with `status: "success"`.
 *
 * Post-broadcast on-chain reverts produce a receipt with `status: "reverted"`
 * and no revert reason — viem's `waitForTransactionReceipt` does NOT throw on
 * reverted receipts, so without this check the SDK would silently return a
 * "successful" txHash for a tx that actually failed.
 */
export declare function assertReceiptSuccess(receipt: {
    status: "success" | "reverted";
}, methodName: string, hash: `0x${string}`): void;
export declare class PolicyViolationError extends AgentSdkError {
    readonly field: string;
    readonly value: unknown;
    constructor(message: string, field: string, value: unknown);
}
export declare function formatContractError(error: unknown): ContractError;
