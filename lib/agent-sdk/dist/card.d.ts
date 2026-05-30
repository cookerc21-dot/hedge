import type { AgentCard, ServiceEntry, GenerateCardOptions, CardUpdates } from "./types.js";
export declare function generateAgentCard(opts: GenerateCardOptions): AgentCard;
export declare function mergeAgentCard(existing: AgentCard, updates: CardUpdates): AgentCard;
export declare function checkServiceReachability(url: string): Promise<string | null>;
export declare function validateServiceEntry(raw: unknown): ServiceEntry | null;
export declare function validateFetchedCard(raw: unknown): AgentCard;
export declare const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
export declare function fetchAgentCard(uri: string, ipfsGateway?: string): Promise<AgentCard>;
