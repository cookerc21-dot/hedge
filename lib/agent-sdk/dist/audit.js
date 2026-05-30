import { appendFileSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { bigintReplacer } from "./formatting.js";
export const DEFAULT_AUDIT_LOG_PATH = join(homedir(), ".injective-agent", "audit.log");
export class AuditLogger {
    source;
    logPath;
    enabled;
    buffer = [];
    timer;
    dirEnsured = false;
    beforeExitHandler;
    constructor(config) {
        this.enabled = config?.enabled ?? true;
        this.source = config?.source ?? "sdk";
        this.logPath = config?.logPath ?? DEFAULT_AUDIT_LOG_PATH;
        if (this.enabled) {
            this.timer = setInterval(() => { this.flush(); }, config?.flushInterval ?? 1000);
            this.timer.unref();
            this.beforeExitHandler = () => this.flushSync();
            process.on("beforeExit", this.beforeExitHandler);
        }
    }
    log(entry) {
        if (!this.enabled)
            return;
        const fullEntry = {
            ...entry,
            source: this.source,
            timestamp: new Date().toISOString(),
        };
        const line = JSON.stringify(fullEntry, bigintReplacer) + "\n";
        this.buffer.push(line);
    }
    async flush() {
        if (this.buffer.length === 0)
            return;
        const batch = this.buffer.splice(0, this.buffer.length);
        try {
            this.ensureDir();
            await appendFile(this.logPath, batch.join(""), { mode: 0o600 });
        }
        catch {
            // Audit logging failure must not crash the signing operation
        }
    }
    flushSync() {
        if (this.buffer.length === 0)
            return;
        const batch = this.buffer.splice(0, this.buffer.length);
        try {
            this.ensureDir();
            appendFileSync(this.logPath, batch.join(""), { mode: 0o600 });
        }
        catch {
            // Audit logging failure must not crash the signing operation
        }
    }
    close() {
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.beforeExitHandler) {
            process.removeListener("beforeExit", this.beforeExitHandler);
            this.beforeExitHandler = undefined;
        }
        this.flushSync();
    }
    ensureDir() {
        if (this.dirEnsured)
            return;
        mkdirSync(dirname(this.logPath), { recursive: true, mode: 0o700 });
        this.dirEnsured = true;
    }
    /** Sanitize contract call args — never includes keys, signatures, or raw metadata bytes */
    static sanitizeArgs(functionName, args) {
        switch (functionName) {
            case "register":
                return {
                    cardUri: args[0],
                    metadataCount: Array.isArray(args[1]) ? args[1].length : 0,
                };
            case "setMetadata":
                return {
                    agentId: String(args[0]),
                    key: args[1],
                    valueLength: typeof args[2] === "string" ? args[2].length : 0,
                };
            case "setAgentURI":
                return { agentId: String(args[0]), uri: args[1] };
            case "setAgentWallet":
                return {
                    agentId: String(args[0]),
                    wallet: args[1],
                    deadline: String(args[2]),
                    // signature intentionally omitted
                };
            case "giveFeedback":
                return {
                    agentId: String(args[0]),
                    value: String(args[1]),
                    valueDecimals: args[2],
                    tag1: args[3],
                    tag2: args[4],
                    endpoint: args[5],
                    // feedbackURI and feedbackHash intentionally omitted
                };
            case "revokeFeedback":
                return { agentId: String(args[0]), feedbackIndex: String(args[1]) };
            default:
                return { argCount: args.length };
        }
    }
}
//# sourceMappingURL=audit.js.map