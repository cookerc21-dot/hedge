import { PolicyViolationError } from "./errors.js";
export function validatePolicy(policy, params) {
    if (policy.allowedWallets && params.wallet) {
        const normalized = params.wallet.toLowerCase();
        if (!policy.allowedWallets.some(w => w.toLowerCase() === normalized)) {
            throw new PolicyViolationError(`Wallet ${params.wallet} is not in the allowed wallet list`, "wallet", params.wallet);
        }
    }
    if (policy.allowedContracts) {
        const normalized = params.contract.toLowerCase();
        if (!policy.allowedContracts.some(c => c.toLowerCase() === normalized)) {
            throw new PolicyViolationError(`Contract ${params.contract} is not in the allowed contract list`, "contract", params.contract);
        }
    }
    if (policy.blockedNamePatterns && params.name) {
        for (const pattern of policy.blockedNamePatterns) {
            if (pattern.test(params.name)) {
                throw new PolicyViolationError(`Agent name matches blocked pattern: ${pattern}`, "name", params.name);
            }
        }
    }
}
//# sourceMappingURL=policy.js.map