import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SignWalletLinkParams } from "./types.js";
export interface ResolvedKey {
    address: `0x${string}`;
    injAddress: string;
    account: ReturnType<typeof privateKeyToAccount>;
}
export declare function resolveKey(privateKey: `0x${string}`): ResolvedKey;
export declare function evmToInj(address: `0x${string}`): string;
export declare function signWalletLink(params: SignWalletLinkParams): Promise<Hex>;
