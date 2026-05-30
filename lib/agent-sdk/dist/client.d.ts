import type { AgentClientConfig, NetworkConfig, RegisterOptions, RegisterResult, UpdateOptions, UpdateResult, StatusResult, GiveFeedbackOptions, GiveFeedbackResult, RevokeFeedbackOptions, RevokeFeedbackResult } from "./types.js";
export declare class AgentClient {
    readonly address: `0x${string}`;
    readonly injAddress: string;
    readonly config: NetworkConfig;
    private key;
    private storage;
    private callbacks;
    private clients;
    private audit;
    private _readClient;
    constructor(opts: AgentClientConfig);
    private get readClient();
    private get auditBase();
    private get reputationAuditBase();
    register(opts: RegisterOptions): Promise<RegisterResult>;
    update(agentId: bigint, opts: UpdateOptions): Promise<UpdateResult>;
    giveFeedback(opts: GiveFeedbackOptions): Promise<GiveFeedbackResult>;
    revokeFeedback(opts: RevokeFeedbackOptions): Promise<RevokeFeedbackResult>;
    getStatus(agentId: bigint): Promise<StatusResult>;
    private resolveImage;
    private checkServices;
}
