export type AgentType = "trading" | "liquidation" | "data" | "portfolio" | "other";
export declare const AGENT_TYPES: AgentType[];
export type ServiceType = "mcp" | "a2a" | "web" | "oasf" | "rest" | "grpc" | "webhook" | "custom";
export declare const SERVICE_TYPES: ServiceType[];
export type ServiceName = "MCP" | "A2A" | "web" | "OASF" | "agentWallet" | "ENS" | "DID" | (string & {});
export declare const LEGACY_SERVICE_NAME_MAP: Record<ServiceType, ServiceName>;
export declare const AGENT_CARD_TYPE: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export declare const AGENT_CARD_TYPE_ALT: "https://erc8004.org/agent-card";
export interface ServiceEntry {
    name: ServiceName;
    endpoint: string;
    description?: string;
    version?: string;
    /** Extra protocol-specific fields: OASF skills/domains, MCP mcpTools/mcpPrompts, A2A a2aSkills, etc. */
    [key: string]: unknown;
}
export interface Registration {
    agentId: bigint | null;
    agentRegistry: string;
}
/**
 * Describes a single callable operation on an agent.
 * Included in the IPFS agent card so LLMs and other agents
 * can construct valid requests without external documentation.
 */
export interface ActionParameter {
    type: "string" | "integer" | "number" | "boolean" | "array" | "object";
    description?: string;
    required?: boolean;
    format?: string;
    enum?: string[];
    default?: string | number | boolean;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    items?: ActionParameter;
    properties?: Record<string, ActionParameter>;
    /** Fixed value — parameter must be exactly this. */
    const?: string | number | boolean;
}
export interface ActionPrerequisite {
    type: "authz_grant" | "token_approval" | "deposit" | "custom";
    description?: string;
    /** For authz_grant: the grantee contract/address. */
    grantee?: string;
    /** For authz_grant: the Cosmos message types to grant. */
    msg_types?: string[];
    /** For token_approval: the spender address. */
    spender?: string;
    /** For token_approval: the token contract. */
    token?: string;
}
export type ActionTransport = "cosmwasm_execute" | "cosmwasm_query" | "evm_call" | "evm_send" | "rest" | "grpc" | "mcp_tool";
export interface ActionSchema {
    name: string;
    description: string;
    transport: ActionTransport;
    /** Contract or endpoint address for this action. */
    contract?: string;
    /** URL for REST/gRPC/MCP transports. */
    url?: string;
    prerequisites?: ActionPrerequisite[];
    parameters: Record<string, ActionParameter>;
    /** Funds/tokens to attach (for CosmWasm execute). */
    funds?: {
        denom: string;
        description?: string;
    };
    /** A complete working example of this action. */
    example?: Record<string, unknown>;
}
export interface AgentCard {
    type: string;
    /** Agent type at top level — must match on-chain agentType metadata to avoid WA080. */
    agentType?: AgentType;
    name: string;
    description?: string;
    services: ServiceEntry[];
    image: string;
    x402Support: boolean;
    /** Machine-readable callable operations. LLMs read this to interact with the agent. */
    actions?: ActionSchema[];
    active?: boolean;
    registrations?: Registration[];
    updatedAt?: number;
    /**
     * Declared trust models the agent supports. Standard values:
     * "reputation" | "crypto-economic" | "tee-attestation" | "social-graph"
     */
    supportedTrust?: string[];
    /** Searchable tags for discovery (e.g. ["defi", "trading", "grid"]). */
    tags?: string[];
    /** Semantic version string (e.g. "1.0.0"). */
    version?: string;
    /** SPDX license identifier (e.g. "MIT", "Apache-2.0"). */
    license?: string;
    /** URL to the agent's source code repository. */
    sourceCode?: string;
    /** URL to the agent's documentation. */
    documentation?: string;
    metadata: {
        chain: "injective";
        chainId: string;
        agentType: AgentType;
        builderCode: string;
        operatorAddress: string;
    };
}
export interface RegisterOptions {
    name: string;
    type: AgentType;
    description?: string;
    builderCode: string;
    wallet: `0x${string}`;
    uri?: string;
    gasPrice?: bigint;
    dryRun?: boolean;
    services?: ServiceEntry[];
    image?: string;
    x402?: boolean;
    actions?: ActionSchema[];
    supportedTrust?: string[];
    tags?: string[];
    version?: string;
    license?: string;
    sourceCode?: string;
    documentation?: string;
}
export interface RegisterResult {
    agentId: bigint;
    identityTuple: string;
    cardUri: string;
    txHashes: `0x${string}`[];
    /**
     * setAgentURI tx hash from the two-phase URI re-upload, if it ran. Exposed
     * separately so callers don't have to guess the position by index — the
     * step is conditional on `card.registrations` and storage availability,
     * so `txHashes[1]` could be either this hash OR `walletTxHash`.
     */
    setUriTxHash?: `0x${string}`;
    /**
     * setAgentWallet tx hash from the wallet-link step, if it ran. Exposed
     * separately for the same reason as `setUriTxHash` — its position in
     * `txHashes` is not stable.
     */
    walletTxHash?: `0x${string}`;
    scanUrl: string;
    gasEstimate?: bigint;
}
export interface UpdateOptions {
    name?: string;
    description?: string;
    builderCode?: string;
    type?: AgentType;
    wallet?: `0x${string}`;
    uri?: string;
    gasPrice?: bigint;
    dryRun?: boolean;
    services?: ServiceEntry[];
    removeServices?: string[];
    image?: string;
    x402?: boolean;
    actions?: ActionSchema[];
    allowFreshCard?: boolean;
    active?: boolean;
    /** Trust models to declare. Replaces existing supportedTrust array when provided. */
    supportedTrust?: string[];
    tags?: string[];
    version?: string;
    license?: string;
    sourceCode?: string;
    documentation?: string;
}
export interface UpdateResult {
    agentId: bigint;
    updatedFields: string[];
    txHashes: `0x${string}`[];
    /**
     * setAgentWallet tx hash, if a wallet-link step ran. Exposed separately
     * so callers don't have to identify it by position in `txHashes` (its
     * index depends on which other fields were updated in the same call).
     */
    walletTxHash?: `0x${string}`;
    simulations?: Array<{
        method: string;
        gasEstimate: bigint;
    }>;
}
export interface StatusResult {
    agentId: bigint;
    name: string;
    type: string;
    owner: `0x${string}`;
    wallet: `0x${string}`;
    builderCode: string;
    tokenUri: string;
    identityTuple: string;
}
export interface NetworkConfig {
    name: string;
    chainId: number;
    rpcUrl: string;
    identityRegistry: `0x${string}`;
    reputationRegistry: `0x${string}`;
    validationRegistry: `0x${string}`;
    ipfsGateway: string;
    deployBlock: bigint;
}
export interface AgentClientConfig {
    privateKey?: `0x${string}`;
    keystorePassword?: string;
    keystorePath?: string;
    network?: "staging" | "testnet" | "mainnet";
    rpcUrl?: string;
    storage?: StorageProvider;
    callbacks?: AgentClientCallbacks;
    audit?: boolean;
    auditLogPath?: string;
    auditSource?: "cli" | "sdk";
}
export interface ReadClientConfig {
    network?: "staging" | "testnet" | "mainnet";
    rpcUrl?: string;
}
export interface AgentClientCallbacks {
    onProgress?: (message: string) => void;
    onWarning?: (message: string) => void;
}
export interface StorageProvider {
    uploadJSON(data: unknown, name?: string): Promise<string>;
    uploadFile?(content: Uint8Array, filename: string, mimeType: string): Promise<string>;
}
export interface GenerateCardOptions {
    name: string;
    type: AgentType;
    description?: string;
    builderCode: string;
    operatorAddress: string;
    services?: ServiceEntry[];
    image?: string;
    x402?: boolean;
    chainId?: number | string;
    actions?: ActionSchema[];
    registryAddress?: `0x${string}`;
    supportedTrust?: string[];
    tags?: string[];
    version?: string;
    license?: string;
    sourceCode?: string;
    documentation?: string;
}
export interface CardUpdates {
    name?: string;
    type?: AgentType;
    description?: string;
    services?: ServiceEntry[];
    removeServices?: string[];
    image?: string;
    x402?: boolean;
    actions?: ActionSchema[];
    active?: boolean;
    supportedTrust?: string[];
    tags?: string[];
    version?: string;
    license?: string;
    sourceCode?: string;
    documentation?: string;
}
export interface DiscoverOptions {
    fromBlock?: bigint;
    chunkSize?: number;
    cacheTtl?: number;
}
export interface ListAgentsOptions {
    offset?: number;
    limit?: number;
    enrich?: boolean;
}
export interface ListAgentsResult {
    agents: StatusResult[];
    total: number;
    offset: number;
    limit: number;
    failed: bigint[];
}
export interface ReputationResult {
    score: number;
    count: number;
    clients: `0x${string}`[];
}
export interface FeedbackEntry {
    client: `0x${string}`;
    feedbackIndex: bigint;
    value: bigint;
    decimals: number;
    tags: [string, string];
    revoked: boolean;
}
export interface GiveFeedbackOptions {
    agentId: bigint;
    value: bigint;
    valueDecimals?: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    feedbackURI?: string;
    feedbackHash?: `0x${string}`;
    gasPrice?: bigint;
    dryRun?: boolean;
}
export interface GiveFeedbackResult {
    txHash: `0x${string}`;
    agentId: bigint;
    feedbackIndex: bigint;
    gasEstimate?: bigint;
}
export interface RevokeFeedbackOptions {
    agentId: bigint;
    feedbackIndex: bigint;
    gasPrice?: bigint;
    dryRun?: boolean;
}
export interface RevokeFeedbackResult {
    txHash: `0x${string}`;
    agentId: bigint;
    gasEstimate?: bigint;
}
export interface FeedbackQueryOptions {
    clientAddresses?: `0x${string}`[];
    tag1?: string;
    tag2?: string;
    includeRevoked?: boolean;
}
export interface ReputationQueryOptions {
    clientAddresses?: `0x${string}`[];
    tag1?: string;
    tag2?: string;
}
export interface EnrichedAgentResult extends StatusResult {
    reputation: ReputationResult;
    card: AgentCard | null;
}
export interface SignWalletLinkParams {
    agentId: bigint;
    wallet: `0x${string}`;
    ownerAddress: `0x${string}`;
    deadline: bigint;
    account: import("viem/accounts").LocalAccount;
    chainId: number;
    contractAddress: `0x${string}`;
}
