export interface TransactionPolicy {
    allowedWallets?: `0x${string}`[];
    allowedContracts?: `0x${string}`[];
    requireSimulation?: boolean;
    blockedNamePatterns?: RegExp[];
}
export declare function validatePolicy(policy: TransactionPolicy, params: {
    wallet?: `0x${string}`;
    contract: `0x${string}`;
    name?: string;
}): void;
