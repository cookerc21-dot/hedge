import { AGENT_CARD_TYPE, LEGACY_SERVICE_NAME_MAP } from "./types.js";
import { assertPublicUrl } from "./validation.js";
import { ValidationError } from "./errors.js";
export function generateAgentCard(opts) {
    const card = {
        type: AGENT_CARD_TYPE,
        agentType: opts.type,
        name: opts.name,
        services: opts.services ?? [],
        image: opts.image ?? "",
        x402Support: opts.x402 ?? false,
        active: true,
        updatedAt: Math.floor(Date.now() / 1000),
        metadata: {
            chain: "injective",
            chainId: String(opts.chainId ?? "unknown"),
            agentType: opts.type,
            builderCode: opts.builderCode,
            operatorAddress: opts.operatorAddress,
        },
    };
    if (opts.registryAddress && opts.chainId !== undefined && opts.chainId !== "") {
        card.registrations = [{
                agentId: null,
                agentRegistry: `eip155:${opts.chainId}:${opts.registryAddress}`,
            }];
    }
    if (opts.description) {
        card.description = opts.description;
    }
    if (opts.actions && opts.actions.length > 0) {
        card.actions = opts.actions;
    }
    if (opts.supportedTrust && opts.supportedTrust.length > 0) {
        card.supportedTrust = opts.supportedTrust;
    }
    if (opts.tags && opts.tags.length > 0)
        card.tags = opts.tags;
    if (opts.version)
        card.version = opts.version;
    if (opts.license)
        card.license = opts.license;
    if (opts.sourceCode)
        card.sourceCode = opts.sourceCode;
    if (opts.documentation)
        card.documentation = opts.documentation;
    return card;
}
export function mergeAgentCard(existing, updates) {
    const card = {
        ...existing,
        type: AGENT_CARD_TYPE, // always normalize to spec URI, regardless of what the existing card stored
        services: existing.services ?? [],
        image: existing.image ?? "",
        x402Support: existing.x402Support ?? false,
    };
    const hasChanges = updates.name !== undefined ||
        updates.description !== undefined ||
        updates.image !== undefined ||
        updates.x402 !== undefined ||
        updates.active !== undefined ||
        updates.supportedTrust !== undefined ||
        updates.tags !== undefined ||
        updates.version !== undefined ||
        updates.license !== undefined ||
        updates.sourceCode !== undefined ||
        updates.documentation !== undefined ||
        updates.type !== undefined ||
        (updates.services?.length ?? 0) > 0 ||
        (updates.removeServices?.length ?? 0) > 0 ||
        updates.actions !== undefined;
    if (updates.name !== undefined)
        card.name = updates.name;
    if (updates.description !== undefined)
        card.description = updates.description;
    if (updates.image !== undefined)
        card.image = updates.image;
    if (updates.x402 !== undefined)
        card.x402Support = updates.x402;
    if (updates.active !== undefined)
        card.active = updates.active;
    if (updates.supportedTrust !== undefined)
        card.supportedTrust = updates.supportedTrust;
    if (updates.tags !== undefined)
        card.tags = updates.tags;
    if (updates.version !== undefined)
        card.version = updates.version;
    if (updates.license !== undefined)
        card.license = updates.license;
    if (updates.sourceCode !== undefined)
        card.sourceCode = updates.sourceCode;
    if (updates.documentation !== undefined)
        card.documentation = updates.documentation;
    if (updates.type !== undefined) {
        card.agentType = updates.type;
        if (card.metadata)
            card.metadata = { ...card.metadata, agentType: updates.type };
    }
    // Only bump updatedAt when something actually changed
    if (hasChanges)
        card.updatedAt = Math.floor(Date.now() / 1000);
    if (updates.services) {
        let merged = [...card.services];
        for (const entry of updates.services) {
            const idx = merged.findIndex(s => s.name === entry.name);
            if (idx >= 0) {
                merged[idx] = entry;
            }
            else {
                merged.push(entry);
            }
        }
        card.services = merged;
    }
    if (updates.removeServices) {
        card.services = card.services.filter(s => !updates.removeServices.includes(s.name));
    }
    if (updates.actions !== undefined) {
        card.actions = updates.actions.length > 0 ? updates.actions : undefined;
    }
    return card;
}
const FETCH_TIMEOUT = 5000;
export async function checkServiceReachability(url) {
    try {
        assertPublicUrl(url, "Service URL");
    }
    catch (err) {
        if (err instanceof ValidationError)
            return null;
        throw err;
    }
    try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        if (!res.ok)
            return `Service URL ${url} returned ${res.status}. Registration will proceed.`;
        return null;
    }
    catch {
        return `Service URL ${url} is not reachable. Registration will proceed.`;
    }
}
/** Field names handled explicitly — all others are passed through as extra protocol-specific data. */
const KNOWN_SERVICE_FIELDS = new Set(["name", "endpoint", "description", "version", "type", "url"]);
export function validateServiceEntry(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const obj = raw;
    // New format: name + endpoint
    if (typeof obj.name === "string" && typeof obj.endpoint === "string") {
        const entry = { name: obj.name, endpoint: obj.endpoint };
        if (typeof obj.description === "string")
            entry.description = obj.description;
        if (typeof obj.version === "string")
            entry.version = obj.version;
        // Preserve extra protocol-specific fields (OASF skills/domains, MCP tools, A2A skills, etc.)
        for (const [key, value] of Object.entries(obj)) {
            if (!KNOWN_SERVICE_FIELDS.has(key))
                entry[key] = value;
        }
        return entry;
    }
    // Legacy format: type + url → convert to name + endpoint
    if (typeof obj.type === "string" && typeof obj.url === "string") {
        const name = LEGACY_SERVICE_NAME_MAP[obj.type] ?? obj.type;
        const entry = { name, endpoint: obj.url };
        if (typeof obj.description === "string")
            entry.description = obj.description;
        for (const [key, value] of Object.entries(obj)) {
            if (!KNOWN_SERVICE_FIELDS.has(key))
                entry[key] = value;
        }
        return entry;
    }
    return null;
}
export function validateFetchedCard(raw) {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("Fetched agent card is not a valid JSON object.");
    }
    const obj = raw;
    if (typeof obj.name !== "string") {
        throw new Error("Fetched agent card has invalid or missing 'name' field.");
    }
    const meta = typeof obj.metadata === "object" && obj.metadata !== null
        ? obj.metadata
        : null;
    const card = {
        type: typeof obj.type === "string" ? obj.type : AGENT_CARD_TYPE,
        name: obj.name,
        description: typeof obj.description === "string" ? obj.description : undefined,
        services: Array.isArray(obj.services)
            ? obj.services.map(validateServiceEntry).filter((s) => s !== null)
            : [],
        image: typeof obj.image === "string" ? obj.image : "",
        x402Support: typeof obj.x402Support === "boolean" ? obj.x402Support : false,
        metadata: meta
            ? {
                chain: "injective",
                chainId: typeof meta.chainId === "string" ? meta.chainId : "unknown",
                agentType: (typeof meta.agentType === "string" ? meta.agentType : "other"),
                builderCode: typeof meta.builderCode === "string" ? meta.builderCode : "",
                operatorAddress: typeof meta.operatorAddress === "string" ? meta.operatorAddress : "",
            }
            : { chain: "injective", chainId: "unknown", agentType: "other", builderCode: "", operatorAddress: "" },
    };
    if (Array.isArray(obj.actions) && obj.actions.length > 0) {
        card.actions = obj.actions;
    }
    if (typeof obj.agentType === "string")
        card.agentType = obj.agentType;
    if (typeof obj.active === "boolean")
        card.active = obj.active;
    if (typeof obj.updatedAt === "number")
        card.updatedAt = obj.updatedAt;
    if (Array.isArray(obj.supportedTrust) && obj.supportedTrust.every(t => typeof t === "string")) {
        card.supportedTrust = obj.supportedTrust;
    }
    if (Array.isArray(obj.tags) && obj.tags.every(t => typeof t === "string")) {
        card.tags = obj.tags;
    }
    if (typeof obj.version === "string")
        card.version = obj.version;
    if (typeof obj.license === "string")
        card.license = obj.license;
    if (typeof obj.sourceCode === "string")
        card.sourceCode = obj.sourceCode;
    if (typeof obj.documentation === "string")
        card.documentation = obj.documentation;
    if (Array.isArray(obj.registrations)) {
        const regs = obj.registrations.flatMap((r) => {
            if (typeof r !== "object" || r === null)
                return [];
            const rec = r;
            if (typeof rec.agentRegistry !== "string")
                return [];
            // Store as number (not BigInt) so the card stays JSON-serializable.
            // Agent IDs are small integers that won't overflow Number.MAX_SAFE_INTEGER.
            const rawId = rec.agentId;
            const agentId = rawId === null || rawId === undefined ? null : BigInt(rawId);
            return [{ agentId, agentRegistry: rec.agentRegistry }];
        });
        if (regs.length > 0)
            card.registrations = regs;
    }
    return card;
}
export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const IPFS_FALLBACK_GATEWAYS = [
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
];
export async function fetchAgentCard(uri, ipfsGateway = DEFAULT_IPFS_GATEWAY) {
    if (!uri.startsWith("ipfs://")) {
        const parsed = new URL(uri);
        if (!["https:", "http:"].includes(parsed.protocol)) {
            throw new Error(`Unsupported URI scheme: ${parsed.protocol}. Only https, http, and ipfs are allowed.`);
        }
        const res = await fetch(uri, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
        if (!res.ok)
            throw new Error(`Failed to fetch agent card from ${uri}: ${res.status}`);
        return validateFetchedCard(await res.json());
    }
    const cid = uri.slice(7);
    const gateways = [ipfsGateway, ...IPFS_FALLBACK_GATEWAYS.filter(g => g !== ipfsGateway)];
    let lastError;
    for (const gateway of gateways) {
        const url = `${gateway}${cid}`;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return validateFetchedCard(await res.json());
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw new Error(`Failed to fetch agent card from all IPFS gateways for ${uri}: ${lastError?.message}`);
}
//# sourceMappingURL=card.js.map