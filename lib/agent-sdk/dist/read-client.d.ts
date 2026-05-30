import type { ReadClientConfig, StatusResult, AgentCard, NetworkConfig, DiscoverOptions, ListAgentsOptions, ListAgentsResult, ReputationResult, FeedbackEntry, EnrichedAgentResult, FeedbackQueryOptions, ReputationQueryOptions } from "./types.js";
export declare class AgentReadClient {
    readonly config: NetworkConfig;
    private publicClient;
    private identityRegistry;
    private reputationRegistry;
    private cachedMinted;
    private cachedBurned;
    private lastScannedBlock;
    private cacheTimestamp;
    private discoverPromise;
    constructor(opts?: ReadClientConfig);
    private getContractData;
    getStatus(agentId: bigint): Promise<StatusResult>;
    fetchCard(uri: string): Promise<AgentCard>;
    ping(): Promise<boolean>;
    pingDetailed(): Promise<{
        reachable: boolean;
        blockNumber?: bigint;
        latencyMs?: number;
    }>;
    discoverAgentIds(opts?: DiscoverOptions): Promise<bigint[]>;
    private refreshCache;
    private scanBlocks;
    private scanBlockRange;
    private getLiveIds;
    listAgents(opts?: ListAgentsOptions): Promise<ListAgentsResult>;
    getAgentsByOwner(address: `0x${string}`, opts?: {
        offset?: number;
        limit?: number;
    }): Promise<ListAgentsResult>;
    getReputation(agentId: bigint, opts?: ReputationQueryOptions): Promise<ReputationResult>;
    getFeedbackEntries(agentId: bigint, opts?: FeedbackQueryOptions): Promise<FeedbackEntry[]>;
    getClients(agentId: bigint): Promise<`0x${string}`[]>;
    getEnrichedAgent(agentId: bigint): Promise<EnrichedAgentResult>;
    watchRegistrations(callback: (event: {
        agentId: bigint;
        owner: `0x${string}`;
        txHash: `0x${string}`;
    }) => void): () => void;
    watchDeregistrations(callback: (event: {
        agentId: bigint;
        previousOwner: `0x${string}`;
        txHash: `0x${string}`;
    }) => void): () => void;
}
