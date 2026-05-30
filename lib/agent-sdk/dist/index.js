// Client classes
export { AgentClient } from "./client.js";
export { AgentReadClient } from "./read-client.js";
// Convenience factory for Node.js (reads process.env)
import { AgentClient } from "./client.js";
import { PinataStorage } from "./storage/pinata.js";
import { ValidationError } from "./errors.js";
export function createAgentClientFromEnv(callbacks) {
    const keystorePassword = process.env.INJ_KEYSTORE_PASSWORD;
    if (keystorePassword !== undefined) {
        return new AgentClient({
            keystorePassword,
            keystorePath: process.env.INJ_KEYSTORE_PATH,
            network: (process.env.INJ_NETWORK ?? "testnet"),
            rpcUrl: process.env.INJ_RPC_URL,
            storage: process.env.PINATA_JWT ? new PinataStorage({ jwt: process.env.PINATA_JWT }) : undefined,
            callbacks,
        });
    }
    const raw = process.env.INJ_PRIVATE_KEY;
    if (raw) {
        process.stderr.write("[warn] INJ_PRIVATE_KEY is deprecated. Run 'inj-agent keys import --env' to encrypt your key.\n");
        const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`);
        return new AgentClient({
            privateKey,
            network: (process.env.INJ_NETWORK ?? "testnet"),
            rpcUrl: process.env.INJ_RPC_URL,
            storage: process.env.PINATA_JWT ? new PinataStorage({ jwt: process.env.PINATA_JWT }) : undefined,
            callbacks,
        });
    }
    throw new ValidationError("No signing key found. Set INJ_KEYSTORE_PASSWORD (with keystore) or INJ_PRIVATE_KEY environment variable.");
}
// Storage providers
export { PinataStorage } from "./storage/pinata.js";
export { CustomUrlStorage } from "./storage/custom-url.js";
// Agent card utilities
export { generateAgentCard, mergeAgentCard, fetchAgentCard, validateFetchedCard, checkServiceReachability, validateServiceEntry, DEFAULT_IPFS_GATEWAY } from "./card.js";
// Wallet utilities
export { evmToInj, signWalletLink, resolveKey } from "./wallet.js";
// Contract utilities
export { identityTuple, encodeStringMetadata, decodeStringMetadata, walletLinkDeadline, MAX_DEADLINE_SECONDS, IdentityRegistryABI, ReputationRegistryABI } from "./contracts.js";
// Config
export { resolveNetworkConfig, STAGING, TESTNET, MAINNET } from "./config.js";
// Validation
export { assertPublicUrl, validateStringField, VALIDATION_LIMITS } from "./validation.js";
// Simulation
export { simulateAndWrite, simulateOnly } from "./simulate.js";
// Audit logging
export { AuditLogger, DEFAULT_AUDIT_LOG_PATH } from "./audit.js";
// Keystore
export { encryptKey, decryptKey, loadKeystore, saveKeystore, DEFAULT_KEYSTORE_PATH } from "./keystore.js";
// Errors
export { AgentSdkError, ContractError, PolicyViolationError, SimulationError, StorageError, ValidationError, formatContractError } from "./errors.js";
// Policy
export { validatePolicy } from "./policy.js";
// Formatting
export { bigintReplacer } from "./formatting.js";
// Constants
export { AGENT_TYPES, SERVICE_TYPES, AGENT_CARD_TYPE, AGENT_CARD_TYPE_ALT, LEGACY_SERVICE_NAME_MAP } from "./types.js";
//# sourceMappingURL=index.js.map