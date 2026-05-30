import { createCipheriv, createDecipheriv, randomBytes, scryptSync, } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { privateKeyToAddress } from "viem/accounts";
import { evmToInj } from "./wallet.js";
export const DEFAULT_KEYSTORE_PATH = join(homedir(), ".injective-agent", "keystore.json");
const SCRYPT_PARAMS = { n: 131072, r: 8, p: 1, dkLen: 32 };
function deriveKey(password, salt, params) {
    return scryptSync(password, salt, params.dkLen, {
        N: params.n, r: params.r, p: params.p,
        maxmem: 128 * params.n * params.r * params.p + 1024 * 1024,
    });
}
export function encryptKey({ privateKey, password }) {
    const salt = randomBytes(32);
    const nonce = randomBytes(12);
    const derivedKey = deriveKey(password, salt, SCRYPT_PARAMS);
    const cipher = createCipheriv("aes-256-gcm", derivedKey, nonce);
    const plaintext = Buffer.from(privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey, "hex");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    plaintext.fill(0);
    const authTag = cipher.getAuthTag();
    derivedKey.fill(0);
    const address = privateKeyToAddress(privateKey);
    return {
        version: 1,
        crypto: {
            kdf: "scrypt",
            kdfParams: { ...SCRYPT_PARAMS, salt: salt.toString("hex") },
            cipher: "aes-256-gcm",
            nonce: nonce.toString("hex"),
            ciphertext: ciphertext.toString("hex"),
            authTag: authTag.toString("hex"),
        },
        address,
        injAddress: evmToInj(address),
        createdAt: new Date().toISOString(),
    };
}
export function decryptKey({ keystore, password }) {
    const { kdfParams, nonce, ciphertext, authTag } = keystore.crypto;
    const salt = Buffer.from(kdfParams.salt, "hex");
    const derivedKey = deriveKey(password, salt, kdfParams);
    try {
        const decipher = createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(nonce, "hex"));
        decipher.setAuthTag(Buffer.from(authTag, "hex"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(ciphertext, "hex")),
            decipher.final(),
        ]);
        const hex = decrypted.toString("hex");
        decrypted.fill(0);
        derivedKey.fill(0);
        return `0x${hex}`;
    }
    catch {
        derivedKey.fill(0);
        throw new Error("Decryption failed. Incorrect password or corrupted keystore.");
    }
}
export function loadKeystore(path) {
    const p = path ?? DEFAULT_KEYSTORE_PATH;
    let raw;
    try {
        raw = readFileSync(p, "utf-8");
    }
    catch (e) {
        if (e?.code === "ENOENT")
            throw new Error(`Keystore not found at ${p}. Run 'inj-agent keys import' to create one.`);
        throw e;
    }
    const ks = JSON.parse(raw);
    if (ks?.version !== 1)
        throw new Error(`Unsupported keystore version: ${ks?.version}. Re-import your key.`);
    return ks;
}
export function saveKeystore(keystore, path) {
    const p = path ?? DEFAULT_KEYSTORE_PATH;
    const dir = dirname(p);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
    writeFileSync(p, JSON.stringify(keystore, null, 2), { mode: 0o600 });
}
//# sourceMappingURL=keystore.js.map