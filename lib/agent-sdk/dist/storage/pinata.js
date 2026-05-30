import { StorageError } from "../errors.js";
const PINATA_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
async function pinataPost(url, init) {
    let response;
    try {
        response = await fetch(url, init);
    }
    catch (err) {
        throw new StorageError(`Could not reach Pinata API: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
        const body = await response.text();
        const truncated = body.length > 200 ? body.slice(0, 200) + "..." : body;
        throw new StorageError(`Pinata upload failed (${response.status}): ${truncated}`);
    }
    const result = await response.json();
    if (!result.IpfsHash) {
        throw new StorageError(`Pinata returned an unexpected response: ${JSON.stringify(result)}`);
    }
    return `ipfs://${result.IpfsHash}`;
}
export class PinataStorage {
    jwt;
    constructor(opts) {
        this.jwt = opts.jwt;
    }
    async uploadJSON(data, name) {
        const slug = typeof name === "string" ? name.toLowerCase().replace(/\s+/g, "-") : "agent-card";
        return pinataPost(PINATA_JSON_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.jwt}`,
            },
            body: JSON.stringify({
                pinataContent: data,
                pinataMetadata: { name: `agent-card-${slug}` },
                pinataOptions: { cidVersion: 1 },
            }, (_k, v) => typeof v === "bigint" ? Number(v) : v),
        });
    }
    async uploadFile(content, filename, mimeType) {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = new Blob([content], { type: mimeType });
        const form = new FormData();
        form.append("file", blob, safeName);
        form.append("pinataMetadata", JSON.stringify({ name: `agent-image-${safeName}` }));
        form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
        return pinataPost(PINATA_FILE_URL, {
            method: "POST",
            headers: { "Authorization": `Bearer ${this.jwt}` },
            body: form,
        });
    }
}
//# sourceMappingURL=pinata.js.map