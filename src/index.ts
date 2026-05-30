import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import {
  AgentClient,
  PinataStorage,
  AgentReadClient,
} from "@injective/agent-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 3001;
const NETWORK = (process.env.INJ_NETWORK ?? "testnet") as "testnet" | "mainnet";

let agentClient: AgentClient | null = null;
const readClient = new AgentReadClient({ network: NETWORK });

// ---- Fee configuration ----
const FEE_BPS = Number(process.env.FEE_BPS ?? "10"); // 0.1% default
const FEE_WALLET = process.env.FEE_WALLET ?? "";
const MIN_PROFIT_WEI = BigInt(process.env.MIN_PROFIT_WEI ?? "1000000000000000"); // 0.001 INJ

// ---- Strategy state ----
interface TradeSignal {
  pair: string;
  action: "buy" | "sell";
  reason: string;
  confidence: number;
}

async function analyzeSignals(): Promise<TradeSignal[]> {
  // In production: connect to Injective DEX APIs, analyze funding rates, order books
  // This is a stub showing the structure
  const signals: TradeSignal[] = [];

  // Example: check if agent has reputation data suggesting profitable trades
  const agentId = process.env.AGENT_ID;
  if (agentId) {
    try {
      const rep = await readClient.getReputation(BigInt(agentId));
      if (rep.score > 0) {
        console.log(`Agent reputation score: ${rep.score} (${rep.count} ratings)`);
      }
    } catch {
      // Not registered yet or read error
    }
  }

  return signals;
}

async function executeTrade(signal: TradeSignal): Promise<string> {
  console.log(`Executing ${signal.action} on ${signal.pair}: ${signal.reason}`);

  // Calculate operator fee
  const feePct = FEE_BPS / 10000;
  console.log(`Fee: ${feePct * 100}% (${FEE_BPS} bps) -> ${FEE_WALLET || "operator"}`);

  // In production: submit actual tx via agentClient or DEX contract
  return `0x${"0".repeat(64)}`;
}

// ---- Scheduler ----
cron.schedule("*/5 * * * *", async () => {
  console.log(`\n[${new Date().toISOString()}] Running trading cycle...`);
  try {
    const signals = await analyzeSignals();
    for (const signal of signals) {
      if (signal.confidence > 0.7) {
        const tx = await executeTrade(signal);
        console.log(`Trade executed: ${tx.slice(0, 10)}...`);
      }
    }
  } catch (err) {
    console.error("Trading cycle error:", err);
  }
});

// ---- HTTP API ----

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agent: process.env.AGENT_NAME ?? "Trading Bot",
    feeBps: FEE_BPS,
    feeWallet: FEE_WALLET || "operator",
  });
});

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: process.env.AGENT_NAME ?? "Trading Bot",
    description: process.env.AGENT_DESCRIPTION ?? "Automated trading agent on Injective",
    services: [
      { name: "A2A", endpoint: `http://localhost:${PORT}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "web", endpoint: `http://localhost:${PORT}` },
    ],
    image: process.env.AGENT_IMAGE ?? "",
    x402Support: true,
    active: true,
    supportedTrust: ["reputation", "crypto-economic"],
    tags: ["trading", "injective", "automated"],
  });
});

app.get("/signals", async (_req, res) => {
  try {
    const signals = await analyzeSignals();
    res.json({ signals });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/status", async (_req, res) => {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    res.json({ registered: false, message: "Not yet registered on-chain" });
    return;
  }
  try {
    const status = await readClient.getStatus(BigInt(agentId));
    const rep = await readClient.getReputation(BigInt(agentId));
    res.json({ ...status, reputation: rep, feeBps: FEE_BPS, feeWallet: FEE_WALLET || "operator" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Fee withdrawal ----
app.post("/admin/withdraw", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey !== process.env.ADMIN_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }
  res.json({ message: "Withdraw triggered", feeBps: FEE_BPS, feeWallet: FEE_WALLET });
});

async function start() {
  if (process.env.INJ_PRIVATE_KEY || process.env.INJ_KEYSTORE_PASSWORD) {
    agentClient = new AgentClient({
      privateKey: process.env.INJ_PRIVATE_KEY as `0x${string}` | undefined,
      keystorePassword: process.env.INJ_KEYSTORE_PASSWORD,
      network: NETWORK,
      storage: process.env.PINATA_JWT ? new PinataStorage({ jwt: process.env.PINATA_JWT }) : undefined,
    });
    console.log(`Agent wallet: ${agentClient.address}`);
    console.log(`Injective address: ${agentClient.injAddress}`);
  }

  console.log(`Fee: ${FEE_BPS} bps (${FEE_BPS / 100}%) -> ${FEE_WALLET || "operator"}`);

  app.listen(PORT, () => {
    console.log(`\n  Trading Agent running at http://localhost:${PORT}`);
    console.log(`  Signals: http://localhost:${PORT}/signals`);
    console.log(`  Status: http://localhost:${PORT}/status`);
    console.log(`  Trading cycle: every 5 minutes\n`);
  });
}

start().catch(console.error);
