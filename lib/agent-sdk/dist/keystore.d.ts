export declare const DEFAULT_KEYSTORE_PATH: string;
export interface KeystoreFile {
    version: 1;
    crypto: {
        kdf: "scrypt";
        kdfParams: {
            n: number;
            r: number;
            p: number;
            dkLen: number;
            salt: string;
        };
        cipher: "aes-256-gcm";
        nonce: string;
        ciphertext: string;
        authTag: string;
    };
    address: `0x${string}`;
    injAddress: string;
    createdAt: string;
}
export interface EncryptKeyOptions {
    privateKey: `0x${string}`;
    password: string;
}
export interface DecryptKeyOptions {
    keystore: KeystoreFile;
    password: string;
}
export declare function encryptKey({ privateKey, password }: EncryptKeyOptions): KeystoreFile;
export declare function decryptKey({ keystore, password }: DecryptKeyOptions): `0x${string}`;
export declare function loadKeystore(path?: string): KeystoreFile;
export declare function saveKeystore(keystore: KeystoreFile, path?: string): void;
