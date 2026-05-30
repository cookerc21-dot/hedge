import type { StorageProvider } from "../types.js";
export declare class CustomUrlStorage implements StorageProvider {
    private uri;
    constructor(uri: string);
    uploadJSON(_data: unknown, _name?: string): Promise<string>;
}
