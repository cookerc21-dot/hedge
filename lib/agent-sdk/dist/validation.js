import { ValidationError } from "./errors.js";
const encoder = new TextEncoder();
const BLOCKED_PROTOCOLS = new Set(["file:", "ftp:", "data:", "javascript:"]);
const PRIVATE_HOSTNAME_PATTERNS = [
    /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./, /^0\.0\.0\.0$/, /^::1$/, /^fc/, /^fd/, /^fe80:/,
];
export const VALIDATION_LIMITS = {
    NAME_MAX_BYTES: 100,
    DESCRIPTION_MAX_BYTES: 500,
    BUILDER_CODE_MAX_BYTES: 100,
    TAG_MAX_BYTES: 64,
    ENDPOINT_MAX_BYTES: 256,
    FEEDBACK_URI_MAX_BYTES: 512,
    VALUE_DECIMALS_MIN: 0,
    VALUE_DECIMALS_MAX: 18,
};
export function validateStringField(value, fieldName, maxBytes, required = false) {
    if (required && (!value || !value.trim())) {
        throw new ValidationError(`${fieldName} is required.`);
    }
    if (value) {
        // Fast exit: each char is at most 4 bytes in UTF-8, so if even that upper bound fits, skip encoding
        if (value.length * 4 > maxBytes) {
            const actualBytes = encoder.encode(value).length;
            if (actualBytes > maxBytes) {
                throw new ValidationError(`${fieldName} exceeds ${maxBytes} byte limit (got ${actualBytes} bytes).`);
            }
        }
    }
}
export function assertPublicUrl(raw, label = "URL") {
    const parsed = new URL(raw);
    if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
        throw new ValidationError(`${label} scheme "${parsed.protocol}" is not allowed. Use https:// or http://.`);
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || PRIVATE_HOSTNAME_PATTERNS.some(r => r.test(host))) {
        throw new ValidationError(`${label} points to a private/internal address and is not allowed.`);
    }
}
//# sourceMappingURL=validation.js.map