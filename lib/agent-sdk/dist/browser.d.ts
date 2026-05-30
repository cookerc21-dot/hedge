/**
 * Browser-safe entry point for @injective/agent-sdk.
 *
 * This module re-exports only the subset of the SDK that runs in browser
 * environments (Vite, Nuxt, Next, webpack).  Nothing here imports node:fs,
 * node:os, or node:path — either directly or transitively.
 *
 * Browser consumers (the Agent Hub, third-party dApps) should use:
 *
 *   import { AgentReadClient } from "@injective/agent-sdk/browser"
 *
 * Or, if the bundler honours the "browser" condition in package.json exports,
 * the bare import works automatically:
 *
 *   import { AgentReadClient } from "@injective/agent-sdk"
 *
 * Node consumers (CLI, scripts) continue importing from the bare specifier,
 * which resolves to index.ts and includes the full surface (AgentClient,
 * keystore, audit, simulation).
 */
export { AgentReadClient } from "./read-client.js";
export { resolveNetworkConfig, STAGING, TESTNET, MAINNET } from "./config.js";
export { fetchAgentCard, validateFetchedCard, DEFAULT_IPFS_GATEWAY, } from "./card.js";
export { IdentityRegistryABI, ReputationRegistryABI, identityTuple, encodeStringMetadata, decodeStringMetadata, } from "./contracts.js";
export { assertPublicUrl, validateStringField, VALIDATION_LIMITS } from "./validation.js";
export { bigintReplacer } from "./formatting.js";
export { AgentSdkError, ContractError, StorageError, ValidationError, formatContractError, } from "./errors.js";
export { AGENT_TYPES, SERVICE_TYPES, AGENT_CARD_TYPE, AGENT_CARD_TYPE_ALT, LEGACY_SERVICE_NAME_MAP, } from "./types.js";
export type { AgentType, ServiceType, ServiceName, ServiceEntry, Registration, AgentCard, ActionSchema, ActionParameter, ActionPrerequisite, ActionTransport, StatusResult, NetworkConfig, ReadClientConfig, StorageProvider, GenerateCardOptions, DiscoverOptions, ListAgentsOptions, ListAgentsResult, ReputationResult, FeedbackEntry, EnrichedAgentResult, FeedbackQueryOptions, ReputationQueryOptions, } from "./types.js";
