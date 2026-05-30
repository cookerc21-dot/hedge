import { BaseError, ContractFunctionRevertedError } from "viem";
export class AgentSdkError extends Error {
    constructor(message) {
        super(message);
        this.name = "AgentSdkError";
    }
}
export class ValidationError extends AgentSdkError {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}
export class ContractError extends AgentSdkError {
    revertReason;
    constructor(message, revertReason) {
        super(message);
        this.name = "ContractError";
        this.revertReason = revertReason;
    }
}
export class StorageError extends AgentSdkError {
    constructor(message) {
        super(message);
        this.name = "StorageError";
    }
}
export class SimulationError extends AgentSdkError {
    revertReason;
    gasEstimate;
    constructor(message, revertReason, gasEstimate) {
        super(message);
        this.name = "SimulationError";
        this.revertReason = revertReason;
        this.gasEstimate = gasEstimate;
    }
}
export function extractRevertName(error) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
}
/**
 * Asserts a viem transaction receipt landed with `status: "success"`.
 *
 * Post-broadcast on-chain reverts produce a receipt with `status: "reverted"`
 * and no revert reason — viem's `waitForTransactionReceipt` does NOT throw on
 * reverted receipts, so without this check the SDK would silently return a
 * "successful" txHash for a tx that actually failed.
 */
export function assertReceiptSuccess(receipt, methodName, hash) {
    if (receipt.status !== "success") {
        throw new ContractError(`${methodName} tx ${hash} reverted on-chain after broadcast. ` +
            `Inspect the transaction on a block explorer to see the revert reason.`);
    }
}
export class PolicyViolationError extends AgentSdkError {
    field;
    value;
    constructor(message, field, value) {
        super(message);
        this.name = "PolicyViolationError";
        this.field = field;
        this.value = value;
    }
}
export function formatContractError(error) {
    if (error instanceof BaseError) {
        const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
        if (revert instanceof ContractFunctionRevertedError) {
            const name = revert.data?.errorName;
            const args = revert.data?.args;
            switch (name) {
                case "EmptyTokenURI":
                    return new ContractError("Registration failed: token URI cannot be empty.", name);
                case "WalletAlreadyLinked":
                    return new ContractError(`Wallet ${args?.[0]} is already linked to agent ${args?.[1]}. Each wallet can only be linked to one agent.`, name);
                case "NotAgentOwner":
                    return new ContractError(`You are not the owner of agent ${args?.[0]}.`, name);
                case "DeadlineExpired":
                    return new ContractError("Wallet signature deadline has expired. Try again.", name);
                case "InvalidSignature":
                    return new ContractError("Invalid wallet signature. Ensure the wallet private key matches the provided wallet address.", name);
                case "SoulboundTransfer":
                    return new ContractError("Agent identity tokens cannot be transferred.", name);
                case "OwnableUnauthorizedAccount":
                    return new ContractError("Not authorized: only the original feedback provider can revoke this feedback.", name);
                case "ERC721NonexistentToken":
                    return new ContractError(`Agent ${args?.[0]} does not exist on the registry.`, name);
                case "ERC721IncorrectOwner":
                    return new ContractError(`Token ownership check failed for agent ${args?.[1]} — expected owner ${args?.[2]}, got ${args?.[0]}.`, name);
                default:
                    return new ContractError(`Transaction reverted: ${name ?? "unknown error"}`, name);
            }
        }
        return new ContractError(`Transaction failed: ${error.shortMessage ?? error.message}`);
    }
    return new ContractError(`Unexpected error: ${String(error)}`);
}
//# sourceMappingURL=errors.js.map