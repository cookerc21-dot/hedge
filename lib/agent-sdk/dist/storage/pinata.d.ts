import type { StorageProvider } from "../types.js";
export declare class PinataStorage implements StorageProvider {
    private jwt;
    constructor(opts: {
        jwt: string;
    });
    uploadJSON(data: unknown, name?: string): Promise<string>;
    uploadFile(content: Uint8Array, filename: string, mimeType: string): Promise<string>;
}
