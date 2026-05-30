export type AuditEvent = "tx:simulate" | "tx:broadcast" | "tx:confirm" | "tx:fail";
export interface AuditEntry {
    timestamp: string;
    event: AuditEvent;
    network: string;
    chainId: number;
    signerAddress: `0x${string}`;
    contract: `0x${string}`;
    method: string;
    args: Record<string, unknown>;
    simulation?: {
        passed: boolean;
        gasEstimate?: string;
        revertReason?: string;
    };
    result?: {
        txHash: `0x${string}`;
        gasUsed?: string;
        blockNumber?: string;
    };
    error?: {
        code: string;
        message: string;
    };
    durationMs: number;
    source: "cli" | "sdk";
}
export interface AuditLoggerConfig {
    logPath?: string;
    enabled?: boolean;
    source?: "cli" | "sdk";
    flushInterval?: number;
}
export declare const DEFAULT_AUDIT_LOG_PATH: string;
export declare class AuditLogger {
    readonly source: "cli" | "sdk";
    private readonly logPath;
    private readonly enabled;
    private buffer;
    private timer;
    private dirEnsured;
    private beforeExitHandler;
    constructor(config?: AuditLoggerConfig);
    log(entry: Omit<AuditEntry, "timestamp" | "source">): void;
    flush(): Promise<void>;
    flushSync(): void;
    close(): void;
    private ensureDir;
    /** Sanitize contract call args — never includes keys, signatures, or raw metadata bytes */
    static sanitizeArgs(functionName: string, args: readonly unknown[]): Record<string, unknown>;
}
