import { privateKeyToAccount } from "viem/accounts";
import { bech32 } from "bech32";
export function resolveKey(privateKey) {
    const account = privateKeyToAccount(privateKey);
    const injAddress = evmToInj(account.address);
    return { address: account.address, injAddress, account };
}
export function evmToInj(address) {
    const bytes = Buffer.from(address.slice(2), "hex");
    const words = bech32.toWords(bytes);
    return bech32.encode("inj", words);
}
export async function signWalletLink(params) {
    const { agentId, wallet, ownerAddress, deadline, account, chainId, contractAddress } = params;
    return account.signTypedData({
        domain: {
            name: "ERC8004IdentityRegistry",
            version: "1",
            chainId,
            verifyingContract: contractAddress,
        },
        types: {
            AgentWalletSet: [
                { name: "agentId", type: "uint256" },
                { name: "newWallet", type: "address" },
                { name: "owner", type: "address" },
                { name: "deadline", type: "uint256" },
            ],
        },
        primaryType: "AgentWalletSet",
        message: {
            agentId,
            newWallet: wallet,
            owner: ownerAddress,
            deadline,
        },
    });
}
//# sourceMappingURL=wallet.js.map