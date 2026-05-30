import { BaseError } from "viem";
import { SimulationError, extractRevertName } from "./errors.js";
/**
 * Simulate a contract call without broadcasting. Throws SimulationError on revert.
 */
export async function simulateOnly(publicClient, params, callbacks) {
    callbacks?.onProgress?.(`Simulating ${params.functionName}...`);
    const simParams = {
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        account: params.account,
        gasPrice: params.gasPrice,
        gas: params.gas,
    };
    try {
        const [{ result }, gasEstimate] = await Promise.all([
            publicClient.simulateContract(simParams),
            publicClient.estimateContractGas(simParams).catch(() => 0n),
        ]);
        callbacks?.onProgress?.(`Simulation passed for ${params.functionName} (est. gas: ${gasEstimate}).`);
        return { method: params.functionName, gasEstimate, result };
    }
    catch (error) {
        if (error instanceof BaseError) {
            throw new SimulationError(`Simulation failed for ${params.functionName}: ${error.shortMessage ?? error.message}`, extractRevertName(error));
        }
        throw new SimulationError(`Simulation failed for ${params.functionName}: ${String(error)}`);
    }
}
/**
 * Convenience helper: simulate then broadcast in one call.
 * Exported for consumers building custom contract interactions.
 * Not used internally — the SDK calls simulateOnly + writeContract
 * separately to capture gasEstimate for audit logging.
 */
export async function simulateAndWrite(publicClient, walletClient, params, callbacks) {
    await simulateOnly(publicClient, params, callbacks);
    callbacks?.onProgress?.(`Broadcasting ${params.functionName}...`);
    return walletClient.writeContract({
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
        account: params.account,
        nonce: params.nonce,
        gasPrice: params.gasPrice,
        gas: params.gas,
    });
}
//# sourceMappingURL=simulate.js.map