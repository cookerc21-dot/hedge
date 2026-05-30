import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentClient,
  PinataStorage,
  AgentReadClient,
} from "@injective/agent-sdk";

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3001);
const NETWORK = (process.env.INJ_NETWORK ?? "testnet") as "testnet" | "mainnet";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "state.json");

// Fee config (0.5% performance fee = 50 bps)
const FEE_BPS = Number(process.env.FEE_BPS ?? "50");
const FEE_WALLET = process.env.FEE_WALLET ?? "";
const MIN_PROFIT_WEI = BigInt(process.env.MIN_PROFIT_WEI ?? "1000000000000000"); // 0.001 INJ

// Strategy parameters
const TRADE_CYCLE_MINUTES = Number(process.env.TRADE_CYCLE_MINUTES ?? "15");
const ATR_PERIOD = Number(process.env.ATR_PERIOD ?? "14");
const SL_ATR_MULTIPLIER = Number(process.env.SL_ATR_MULTIPLIER ?? "2.0");
const TP_ATR_MULTIPLIER = Number(process.env.TP_ATR_MULTIPLIER ?? "3.0");
const MAX_POSITION_SIZE_USD = Number(process.env.MAX_POSITION_SIZE_USD ?? "100");
const MAX_CONCURRENT_POSITIONS = Number(process.env.MAX_CONCURRENT_POSITIONS ?? "3");

// Pairs to monitor (configure comma-separated, e.g. "INJ/USDT,INJ/USDC,BTC/USDT")
const TRADING_PAIRS = (process.env.TRADING_PAIRS ?? "INJ/USDT,INJ/USDC,BTC/USDT").split(",").map(s => s.trim());
// Correlated pairs for delta-neutral hedging: "source:hedge"
// e.g. "INJ/USDT:INJ/USDC" means when long INJ/USDT, short INJ/USDC
const HEDGE_PAIRS = (process.env.HEDGE_PAIRS ?? "").split(",").map(s => s.trim()).filter(Boolean);

// Market data API base
const INJ_EXCHANGE_API = process.env.INJ_EXCHANGE_API ?? "https://api.injective.exchange";
const SIMULATE_MARKETS = process.env.SIMULATE_MARKETS === "true" || !process.env.INJ_EXCHANGE_API;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface PriceCandle {
  time: number;    // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketData {
  pair: string;
  price: number;
  markPrice: number;
  fundingRate: number;
  volume24h: number;
  candles: PriceCandle[];
  lastUpdated: number;
}

interface Position {
  id: string;
  pair: string;
  direction: "long" | "short";
  entryPrice: number;
  size: number;           // in USD
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  hedgePositionId?: string;
}

interface TradeSignal {
  pair: string;
  direction: "long" | "short";
  confidence: number;     // 0-1
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  size: number;           // USD
}

interface HourlyPerformance {
  hour: number;           // 0-23
  trades: number;
  wins: number;
  totalPnl: number;       // in USD
  avgConfidence: number;
}

interface StrategyState {
  markets: Record<string, MarketData>;
  positions: Position[];
  performance: Record<string, HourlyPerformance[]>;  // pair -> hourly stats
  tradeHistory: TradeRecord[];
  startTime: number;
  cycleCount: number;
}

interface TradeRecord {
  id: string;
  pair: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;            // USD
  fee: number;            // USD
  openedAt: number;
  closedAt: number;
  reason: string;
  hour: number;
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let state: StrategyState = loadState();

function loadState(): StrategyState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch { /* start fresh */ }
  return {
    markets: {},
    positions: [],
    performance: {},
    tradeHistory: [],
    startTime: Date.now(),
    cycleCount: 0,
  };
}

function saveState(): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────
// Market Data (Injective Exchange API)
// ─────────────────────────────────────────────────────────────
async function fetchInjectiveMarkets(): Promise<{ marketId: string; ticker: string; base: string; quote: string }[]> {
  try {
    const url = `${INJ_EXCHANGE_API}/api/v2/markets?status=active`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return (data.markets ?? []).map((m: any) => ({
      marketId: m.marketId ?? m.id,
      ticker: m.ticker ?? "",
      base: m.baseToken?.symbol ?? m.base ?? "",
      quote: m.quoteToken?.symbol ?? m.quote ?? "",
    })).filter((m: any) => TRADING_PAIRS.some(p => {
      const [b, q] = p.split("/");
      return m.base === b && m.quote === q;
    }));
  } catch {
    return [];
  }
}

async function fetchTickerPrice(marketId: string): Promise<{ price: number; markPrice: number; volume24h: number } | null> {
  try {
    const url = `${INJ_EXCHANGE_API}/api/v2/orders/ticker/${marketId}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    return {
      price: parseFloat(data.lastPrice ?? data.price ?? "0"),
      markPrice: parseFloat(data.markPrice ?? data.lastPrice ?? "0"),
      volume24h: parseFloat(data.volume24h ?? "0"),
    };
  } catch {
    return null;
  }
}

async function fetchCandles(
  marketId: string,
  interval: string = "15m",
  limit: number = 100
): Promise<PriceCandle[]> {
  try {
    const url = `${INJ_EXCHANGE_API}/api/v2/markets/${marketId}/candles?interval=${interval}&limit=${limit}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return (data.candles ?? data ?? []).map((c: any) => ({
      time: new Date(c.time ?? c.t ?? c[0]).getTime(),
      open: parseFloat(c.open ?? c.o ?? c[1]),
      high: parseFloat(c.high ?? c.h ?? c[2]),
      low: parseFloat(c.low ?? c.l ?? c[3]),
      close: parseFloat(c.close ?? c.c ?? c[4]),
      volume: parseFloat(c.volume ?? c.v ?? c[5] ?? 0),
    }));
  } catch {
    return [];
  }
}

async function fetchFundingRate(marketId: string): Promise<number> {
  try {
    const url = `${INJ_EXCHANGE_API}/api/v2/funding/rates/${marketId}?limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return 0;
    const data: any = await resp.json();
    return parseFloat(data.rates?.[0]?.rate ?? "0");
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// Technical Analysis
// ─────────────────────────────────────────────────────────────

/** Calculate ATR (Average True Range) */
function calculateATR(candles: PriceCandle[], period: number): number {
  if (candles.length < period + 1) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  // SMA of true ranges
  const recent = trueRanges.slice(-period);
  return recent.reduce((sum, v) => sum + v, 0) / period;
}

/** Calculate SMA */
function calculateSMA(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  const recent = values.slice(-period);
  return recent.reduce((sum, v) => sum + v, 0) / period;
}

/** Calculate standard deviation */
function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

/** Find optimal trading hour based on historical performance */
function findOptimalHour(pair: string): { hour: number; score: number } {
  const perf = state.performance[pair];
  if (!perf || perf.length < 3) {
    // Not enough data — return neutral (current hour)
    return { hour: new Date().getUTCHours(), score: 0.5 };
  }
  // Score each hour: winRate * 0.6 + (totalPnl / maxPnl * 0.4)
  const maxPnl = Math.max(...perf.map(p => Math.abs(p.totalPnl)), 1);
  let best = { hour: perf[0].hour, score: 0 };
  for (const h of perf) {
    const winRate = h.trades > 0 ? h.wins / h.trades : 0;
    const pnlScore = maxPnl > 0 ? h.totalPnl / maxPnl : 0;
    const score = winRate * 0.6 + pnlScore * 0.4;
    if (score > best.score) best = { hour: h.hour, score };
  }
  // Boost score if we have enough data
  const total = perf.reduce((s, h) => s + h.trades, 0);
  return { ...best, score: best.score * Math.min(total / 20, 1) };
}

// ─────────────────────────────────────────────────────────────
// Strategy: Signal Generation
// ─────────────────────────────────────────────────────────────
function generateSignals(): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const currentHour = new Date().getUTCHours();

  for (const pair of TRADING_PAIRS) {
    const market = state.markets[pair];
    if (!market || market.candles.length < ATR_PERIOD + 5) continue;

    const candles = market.candles;
    const prices = candles.map(c => c.close);
    const currentPrice = market.price;
    if (currentPrice <= 0) continue;

    // Volatility analysis
    const atr = calculateATR(candles, ATR_PERIOD);
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, Math.min(50, prices.length));
    const stdDev = calculateStdDev(prices.slice(-20));
    const volRatio = stdDev / currentPrice;
    const priceChange = prices.length > 1
      ? (currentPrice - prices[prices.length - 5]) / prices[prices.length - 5]
      : 0;

    // Time-of-day analysis
    const timeOptimal = findOptimalHour(pair);

    let confidence = 0;
    let direction: "long" | "short" = "long";
    let reason = "";

    // Trend detection
    const trendingUp = sma20 > sma50 && priceChange > 0;
    const trendingDown = sma20 < sma50 && priceChange < 0;

    // Mean reversion — strong move > 1.5 ATR likely reverts
    const recentMove = prices.length > 1
      ? Math.abs(prices[prices.length - 1] - prices[prices.length - 5]) / Math.max(atr, 0.0001)
      : 0;

    if (trendingUp && recentMove > 1.5) {
      direction = "short";
      confidence = 0.35 + Math.min(recentMove / 10, 0.35);
      reason = `Overextended up (move=${recentMove.toFixed(1)}x ATR)`;
    } else if (trendingDown && recentMove > 1.5) {
      direction = "long";
      confidence = 0.35 + Math.min(recentMove / 10, 0.35);
      reason = `Oversold (move=${recentMove.toFixed(1)}x ATR)`;
    } else if (trendingUp && volRatio > 0.005 && priceChange > 0.005) {
      direction = "long";
      confidence = 0.45 + Math.min(priceChange * 8, 0.35);
      reason = `Momentum up (${(priceChange * 100).toFixed(2)}%)`;
    } else if (trendingDown && volRatio > 0.005 && priceChange < -0.005) {
      direction = "short";
      confidence = 0.45 + Math.min(Math.abs(priceChange) * 8, 0.35);
      reason = `Momentum down (${(priceChange * 100).toFixed(2)}%)`;
    } else if (timeOptimal.score > 0.55) {
      direction = sma20 > sma50 ? "long" : "short";
      confidence = timeOptimal.score;
      reason = `Time-of-day (hour ${timeOptimal.hour}UTC, score=${timeOptimal.score.toFixed(2)})`;
    } else if (volRatio > 0.003 && Math.abs(priceChange) > 0.003) {
      direction = priceChange > 0 ? "short" : "long";
      confidence = 0.3;
      reason = `Range trade (vol=${(volRatio * 100).toFixed(2)}%, move=${(priceChange * 100).toFixed(2)}%)`;
    } else if (Math.abs(priceChange) > 0.002) {
      direction = priceChange > 0 ? "long" : "short";
      confidence = 0.25;
      reason = `Baseline trend (${(priceChange * 100).toFixed(2)}%)`;
    } else {
      continue;
    }

    // Calculate SL/TP
    const slPrice = direction === "long"
      ? currentPrice - atr * SL_ATR_MULTIPLIER
      : currentPrice + atr * SL_ATR_MULTIPLIER;
    const tpPrice = direction === "long"
      ? currentPrice + atr * TP_ATR_MULTIPLIER
      : currentPrice - atr * TP_ATR_MULTIPLIER;

    // Position sizing (Kelly-like fraction based on confidence)
    const baseSize = MAX_POSITION_SIZE_USD * Math.min(confidence * 1.5, 1);
    const maxLossPct = (atr * SL_ATR_MULTIPLIER) / currentPrice;
    const riskAdjustedSize = maxLossPct > 0
      ? Math.min(baseSize, Math.abs(currentPrice - slPrice) * baseSize / (atr * SL_ATR_MULTIPLIER))
      : baseSize;

    signals.push({
      pair,
      direction,
      confidence,
      entryPrice: currentPrice,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      reason,
      size: Math.round(riskAdjustedSize * 100) / 100,
    });
  }

  // Sort by confidence descending
  signals.sort((a, b) => b.confidence - a.confidence);
  return signals;
}

// ─────────────────────────────────────────────────────────────
// Strategy: Hedge Execution
// ─────────────────────────────────────────────────────────────
function executeSignals(signals: TradeSignal[]): void {
  const openCount = state.positions.filter(p => {
    const age = Date.now() - p.openedAt;
    return age < 1000 * 60 * 60 * 24; // max 24h position duration
  }).length;

  // Take top signals within position limits
  const takeSignals = signals
    .filter(s => s.confidence >= 0.35)
    .slice(0, Math.max(0, MAX_CONCURRENT_POSITIONS - openCount));

  for (const signal of takeSignals) {
    const pos: Position = {
      id: generateId(),
      pair: signal.pair,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      size: signal.size,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      openedAt: Date.now(),
    };

    // Check if there's a hedge pair configured
    const hedgeConfig = HEDGE_PAIRS.find(hp => hp.startsWith(signal.pair + ":"));
    if (hedgeConfig) {
      const [, hedgePair] = hedgeConfig.split(":");
      const hedgeMarket = state.markets[hedgePair];
      if (hedgeMarket && hedgeMarket.price > 0) {
        // Open offsetting position on hedge pair
        const hedgeDirection = signal.direction === "long" ? "short" : "long";
        const hedgeSize = signal.size * (signal.entryPrice / hedgeMarket.price);
        const hedgeAtr = calculateATR(hedgeMarket.candles, ATR_PERIOD);
        const hedgeSl = hedgeDirection === "long"
          ? hedgeMarket.price - hedgeAtr * SL_ATR_MULTIPLIER
          : hedgeMarket.price + hedgeAtr * SL_ATR_MULTIPLIER;
        const hedgeTp = hedgeDirection === "long"
          ? hedgeMarket.price + hedgeAtr * TP_ATR_MULTIPLIER
          : hedgeMarket.price - hedgeAtr * TP_ATR_MULTIPLIER;

        const hedgePos: Position = {
          id: generateId(),
          pair: hedgePair,
          direction: hedgeDirection,
          entryPrice: hedgeMarket.price,
          size: hedgeSize,
          stopLoss: hedgeSl,
          takeProfit: hedgeTp,
          openedAt: Date.now(),
          hedgePositionId: pos.id,
        };
        pos.hedgePositionId = hedgePos.id;
        state.positions.push(hedgePos);
        console.log(`  [HEDGE] ${hedgeDirection.toUpperCase()} ${hedgePair} @ ${hedgeMarket.price} (SL: ${hedgeSl.toFixed(4)}, TP: ${hedgeTp.toFixed(4)})`);
      }
    }

    state.positions.push(pos);
    console.log(`  [OPEN] ${pos.direction.toUpperCase()} ${pos.pair} @ ${pos.entryPrice} (size: $${pos.size}, SL: ${pos.stopLoss.toFixed(4)}, TP: ${pos.takeProfit.toFixed(4)})`);
    console.log(`    → ${signal.reason}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Position Monitoring & Close
// ─────────────────────────────────────────────────────────────
function checkPositions(): { closed: TradeRecord[]; pnl: number } {
  const closed: TradeRecord[] = [];
  let totalPnl = 0;
  const stillOpen: Position[] = [];
  const now = Date.now();
  const maxAge = 1000 * 60 * 60 * 24; // 24h

  for (const pos of state.positions) {
    const age = now - pos.openedAt;
    if (age > maxAge) {
      // Force close — time expiry
      const market = state.markets[pos.pair];
      const exitPrice = market?.price ?? pos.entryPrice;
      const pnl = pos.direction === "long"
        ? (exitPrice - pos.entryPrice) / pos.entryPrice * pos.size
        : (pos.entryPrice - exitPrice) / pos.entryPrice * pos.size;
      const fee = Math.abs(pnl) * (FEE_BPS / 10000);
      const record: TradeRecord = {
        id: pos.id,
        pair: pos.pair,
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        exitPrice,
        size: pos.size,
        pnl,
        fee,
        openedAt: pos.openedAt,
        closedAt: now,
        reason: "time-expiry",
        hour: new Date(pos.openedAt).getUTCHours(),
      };
      closed.push(record);
      totalPnl += pnl;
      console.log(`  [CLOSE] ${pos.direction.toUpperCase()} ${pos.pair} — TIME EXPIRY (pnl: $${pnl.toFixed(2)})`);
      continue;
    }

    const market = state.markets[pos.pair];
    if (!market?.price) { stillOpen.push(pos); continue; }

    // Check stop-loss
    if (pos.direction === "long" && market.price <= pos.stopLoss) {
      const pnl = (pos.stopLoss - pos.entryPrice) / pos.entryPrice * pos.size;
      const fee = Math.abs(pnl) * (FEE_BPS / 10000);
      closed.push({ id: pos.id, pair: pos.pair, direction: pos.direction, entryPrice: pos.entryPrice, exitPrice: pos.stopLoss, size: pos.size, pnl, fee, openedAt: pos.openedAt, closedAt: now, reason: "stop-loss", hour: new Date(pos.openedAt).getUTCHours() });
      totalPnl += pnl;
      console.log(`  [CLOSE] ${pos.direction.toUpperCase()} ${pos.pair} — STOP-LOSS (pnl: $${pnl.toFixed(2)})`);
      continue;
    }
    if (pos.direction === "short" && market.price >= pos.stopLoss) {
      const pnl = (pos.entryPrice - pos.stopLoss) / pos.entryPrice * pos.size;
      const fee = Math.abs(pnl) * (FEE_BPS / 10000);
      closed.push({ id: pos.id, pair: pos.pair, direction: pos.direction, entryPrice: pos.entryPrice, exitPrice: pos.stopLoss, size: pos.size, pnl, fee, openedAt: pos.openedAt, closedAt: now, reason: "stop-loss", hour: new Date(pos.openedAt).getUTCHours() });
      totalPnl += pnl;
      console.log(`  [CLOSE] ${pos.direction.toUpperCase()} ${pos.pair} — STOP-LOSS (pnl: $${pnl.toFixed(2)})`);
      continue;
    }

    // Check take-profit
    if (pos.direction === "long" && market.price >= pos.takeProfit) {
      const pnl = (pos.takeProfit - pos.entryPrice) / pos.entryPrice * pos.size;
      const fee = Math.abs(pnl) * (FEE_BPS / 10000);
      closed.push({ id: pos.id, pair: pos.pair, direction: pos.direction, entryPrice: pos.entryPrice, exitPrice: pos.takeProfit, size: pos.size, pnl, fee, openedAt: pos.openedAt, closedAt: now, reason: "take-profit", hour: new Date(pos.openedAt).getUTCHours() });
      totalPnl += pnl;
      console.log(`  [CLOSE] ${pos.direction.toUpperCase()} ${pos.pair} — TAKE-PROFIT (pnl: $${pnl.toFixed(2)})`);
      continue;
    }

    stillOpen.push(pos);
  }

  state.positions = stillOpen;
  return { closed, pnl: totalPnl };
}

function recordPerformance(trades: TradeRecord[]): void {
  for (const t of trades) {
    if (!state.performance[t.pair]) {
      state.performance[t.pair] = Array.from({ length: 24 }, (_, i) => ({
        hour: i, trades: 0, wins: 0, totalPnl: 0, avgConfidence: 0,
      }));
    }
    const h = state.performance[t.pair][t.hour];
    if (h) {
      h.trades++;
      if (t.pnl > 0) h.wins++;
      h.totalPnl += t.pnl;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Fee Management
// ─────────────────────────────────────────────────────────────
function calculatePerformanceFee(pnl: number): number {
  if (pnl <= 0) return 0;
  return pnl * (FEE_BPS / 10000);
}

function transferFee(pnl: number): void {
  const fee = calculatePerformanceFee(pnl);
  if (fee <= 0) return;
  if (!FEE_WALLET) {
    console.log(`  [FEE] ${fee.toFixed(4)} USD performance fee accrued (${FEE_BPS} bps) — no fee wallet configured`);
    return;
  }
  console.log(`  [FEE] ${fee.toFixed(4)} USD → ${FEE_WALLET} (${FEE_BPS} bps performance fee)`);
  // In production: execute on-chain transfer via AgentClient
}

// ─────────────────────────────────────────────────────────────
// Simulated Market Data (fallback when API unavailable)
// ─────────────────────────────────────────────────────────────
const BASE_PRICES: Record<string, number> = {
  "INJ/USDT": 24.50,
  "INJ/USDC": 24.48,
  "BTC/USDT": 67800,
  "ETH/USDT": 3450,
  "ATOM/USDT": 8.20,
  "SOL/USDT": 142.0,
  "TIA/USDT": 9.80,
};

// State for random walk
let simPrices: Record<string, number> = {};
let simCandles: Record<string, PriceCandle[]> = {};

function generateSimulatedCandles(pair: string, basePrice: number, count: number): PriceCandle[] {
  const candles: PriceCandle[] = [];
  let price = simPrices[pair] ?? basePrice;
  const now = Date.now();
  const intervalMs = 15 * 60 * 1000; // 15 min

  for (let i = 0; i < count; i++) {
    // Random walk with mean reversion and slight drift
    const drift = (Math.random() - 0.48) * 0.004;
    const shock = (Math.random() - 0.5) * 0.02;
    const reversion = (basePrice - price) / basePrice * 0.003;

    const change = price * (drift + shock + reversion);
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.008);
    const low = Math.min(open, close) * (1 - Math.random() * 0.008);
    const volume = Math.random() * 1000000 + 100000;

    candles.push({
      time: now - (count - i) * intervalMs,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  simPrices[pair] = price;
  simCandles[pair] = candles;
  return candles;
}

function simulateMarketData(): void {
  const now = Date.now();
  for (const pair of TRADING_PAIRS) {
    const basePrice = BASE_PRICES[pair] ?? 100;
    const candles = generateSimulatedCandles(pair, basePrice, 100);
    const price = candles[candles.length - 1].close;

    state.markets[pair] = {
      pair,
      price,
      markPrice: price * (1 + (Math.random() - 0.5) * 0.001),
      fundingRate: (Math.random() - 0.5) * 0.0002,
      volume24h: Math.random() * 5000000 + 500000,
      candles,
      lastUpdated: now,
    };

    const atr = calculateATR(candles, ATR_PERIOD);
    console.log(`  ${pair}: $${price.toFixed(4)} (vol: ${(state.markets[pair].volume24h).toFixed(0)}, ATR: ${atr.toFixed(4)}, funding: ${(state.markets[pair].fundingRate * 100).toFixed(4)}%)`);
  }
}

// ─────────────────────────────────────────────────────────────
// Main Trading Cycle
// ─────────────────────────────────────────────────────────────
async function tradingCycle(): Promise<void> {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`[${new Date().toISOString()}] Trading cycle #${++state.cycleCount}`);
  console.log(`═══════════════════════════════════════════`);

  // 1. Update market data
  console.log(`\n[Market] Fetching data for ${TRADING_PAIRS.length} pair(s)...`);

  if (SIMULATE_MARKETS) {
    simulateMarketData();
  } else {
    // Discover market IDs for our pairs
    const availableMarkets = await fetchInjectiveMarkets();
    const marketIdMap = new Map<string, string>();
    for (const m of availableMarkets) {
      const pair = `${m.base}/${m.quote}`;
      marketIdMap.set(pair, m.marketId);
    }

    for (const pair of TRADING_PAIRS) {
      const mid = marketIdMap.get(pair);
      if (!mid) {
        console.log(`  ${pair}: no market ID found`);
        continue;
      }

      const [ticker, candles, fundingRate] = await Promise.all([
        fetchTickerPrice(mid),
        fetchCandles(mid, "15m", 100),
        fetchFundingRate(mid),
      ]);

      if (ticker && ticker.price > 0) {
        state.markets[pair] = {
          pair,
          price: ticker.price,
          markPrice: ticker.markPrice || ticker.price,
          fundingRate,
          volume24h: ticker.volume24h,
          candles,
          lastUpdated: Date.now(),
        };
        const atr = calculateATR(candles, ATR_PERIOD);
        console.log(`  ${pair}: $${ticker.price} (vol: ${ticker.volume24h.toFixed(0)}, ATR: ${atr.toFixed(4)}, funding: ${(fundingRate * 100).toFixed(4)}%)`);
      } else {
        console.log(`  ${pair}: no ticker data`);
      }
    }
  }

  // 2. Check existing positions
  console.log(`\n[Positions] Checking ${state.positions.length} open position(s)...`);
  const { closed, pnl } = checkPositions();

  // 3. Record performance and charge fees
  if (closed.length > 0) {
    recordPerformance(closed);
    for (const t of closed) {
      const fee = t.pnl > 0 ? calculatePerformanceFee(t.pnl) : 0;
      state.tradeHistory.push(t);
      console.log(`  Trade $${t.pnl.toFixed(2)} (fee: $${fee.toFixed(4)})`);
    }
    if (pnl > 0) transferFee(pnl);
  }

  // 4. Generate new signals
  console.log(`\n[Analysis] Generating signals...`);
  const signals = generateSignals();
  console.log(`  Generated ${signals.length} signal(s)`);
  for (const s of signals) {
    console.log(`  ${(s.confidence * 100).toFixed(0)}% | ${s.direction.toUpperCase()} ${s.pair} @ ${s.entryPrice} | SL: ${s.stopLoss.toFixed(4)} TP: ${s.takeProfit.toFixed(4)} | $${s.size}`);
    console.log(`    → ${s.reason}`);
  }

  // 5. Execute
  if (signals.length > 0) {
    console.log(`\n[Execution] Taking top signals...`);
    executeSignals(signals);
  }

  // 6. Summary
  const totalPositions = state.positions.length;
  const totalClosed = state.tradeHistory.length;
  const totalProfit = state.tradeHistory.reduce((s, t) => s + t.pnl, 0);
  const totalFees = state.tradeHistory.reduce((s, t) => s + t.fee, 0);
  console.log(`\n[Summary]`);
  console.log(`  Open positions: ${totalPositions}`);
  console.log(`  Total trades: ${totalClosed}`);
  console.log(`  Total P&L: $${totalProfit.toFixed(2)}`);
  console.log(`  Total fees: $${totalFees.toFixed(2)}`);
  console.log(`═══ End cycle #${state.cycleCount} ═══\n`);

  saveState();
}

// ─────────────────────────────────────────────────────────────
// Express Server
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

let agentClient: AgentClient | null = null;
const readClient = new AgentReadClient({ network: NETWORK });

// Health
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agent: process.env.AGENT_NAME ?? "Hedge",
    version: "1.0.0",
    network: NETWORK,
    cycles: state.cycleCount,
    openPositions: state.positions.length,
    totalTrades: state.tradeHistory.length,
    totalPnl: state.tradeHistory.reduce((s, t) => s + t.pnl, 0).toFixed(2),
    feeBps: FEE_BPS,
    feeWallet: FEE_WALLET || "operator",
    pairs: TRADING_PAIRS,
  });
});

// .well-known/agent-card.json
app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: process.env.AGENT_NAME ?? "Hedge",
    description: process.env.AGENT_DESCRIPTION ?? "Hedge-based trading bot — time-of-day analysis, volatility SL/TP, delta-neutral hedging, 0.5% performance fee",
    services: [
      { name: "A2A", endpoint: `http://localhost:${PORT}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "web", endpoint: `http://localhost:${PORT}` },
    ],
    image: process.env.AGENT_IMAGE ?? "",
    x402Support: true,
    active: true,
    supportedTrust: ["reputation", "crypto-economic"],
    tags: ["trading", "hedge", "injective", "automated", "delta-neutral"],
  });
});

// Current signals
app.get("/signals", async (_req, res) => {
  try {
    const signals = generateSignals();
    res.json({
      signals,
      timestamp: new Date().toISOString(),
      openPositions: state.positions.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Market data
app.get("/markets", (_req, res) => {
  res.json({
    pairs: TRADING_PAIRS,
    markets: state.markets,
    timestamp: new Date().toISOString(),
  });
});

// Open positions
app.get("/positions", (_req, res) => {
  res.json({
    positions: state.positions,
    count: state.positions.length,
    timestamp: new Date().toISOString(),
  });
});

// Trade history
app.get("/trades", (_req, res) => {
  const limit = Math.min(Number((_req as any).query.limit ?? 100), 1000);
  res.json({
    trades: state.tradeHistory.slice(-limit),
    count: Math.min(state.tradeHistory.length, limit),
    total: state.tradeHistory.length,
    totalPnl: state.tradeHistory.reduce((s, t) => s + t.pnl, 0).toFixed(2),
    timestamp: new Date().toISOString(),
  });
});

// Performance by hour
app.get("/performance", (_req, res) => {
  res.json({
    pairs: Object.keys(state.performance),
    performance: state.performance,
    timestamp: new Date().toISOString(),
  });
});

// Force a trading cycle
app.post("/cycle", async (_req, res) => {
  try {
    await tradingCycle();
    res.json({ success: true, cycle: state.cycleCount, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Status (on-chain registration)
app.get("/status", async (_req, res) => {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    res.json({ registered: false, message: "Not yet registered on-chain" });
    return;
  }
  try {
    const status = await readClient.getStatus(BigInt(agentId));
    const rep = await readClient.getReputation(BigInt(agentId));
    res.json({
      ...status,
      reputation: rep,
      feeBps: FEE_BPS,
      feeWallet: FEE_WALLET || "operator",
      cycles: state.cycleCount,
      openPositions: state.positions.length,
      totalPnl: state.tradeHistory.reduce((s, t) => s + t.pnl, 0).toFixed(2),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fee withdrawal (admin)
app.post("/admin/withdraw", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey !== process.env.ADMIN_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }
  const totalFees = state.tradeHistory.reduce((s, t) => s + t.fee, 0);
  res.json({
    message: "Withdraw triggered",
    feeBps: FEE_BPS,
    feeWallet: FEE_WALLET,
    accruedFees: totalFees.toFixed(4),
    tradeCount: state.tradeHistory.length,
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
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

  console.log(`Network: ${NETWORK}`);
  console.log(`Markets: ${TRADING_PAIRS.join(", ")}`);
  console.log(`Cycle: every ${TRADE_CYCLE_MINUTES} minutes`);
  console.log(`Max positions: ${MAX_CONCURRENT_POSITIONS}`);
  console.log(`Position size: $${MAX_POSITION_SIZE_USD} per trade`);
  console.log(`SL: ${SL_ATR_MULTIPLIER}x ATR | TP: ${TP_ATR_MULTIPLIER}x ATR`);
  console.log(`Fee: ${FEE_BPS} bps (${FEE_BPS / 100}%) → ${FEE_WALLET || "operator"}`);
  console.log(`Hedge pairs: ${HEDGE_PAIRS.length > 0 ? HEDGE_PAIRS.join(", ") : "none"}`);
  console.log(`State: ${STATE_FILE}`);

  // Schedule trading cycle
  const cronExpr = `*/${TRADE_CYCLE_MINUTES} * * * *`;
  cron.schedule(cronExpr, () => {
    tradingCycle().catch(err => console.error("Cycle error:", err));
  });

  // Run first cycle immediately
  tradingCycle().catch(err => console.error("Initial cycle error:", err));

  // Start server
  app.listen(PORT, () => {
    console.log(`\n  🛡️  Hedge Trading Agent running at http://localhost:${PORT}`);
    console.log(`  📊 Signals: http://localhost:${PORT}/signals`);
    console.log(`  📈 Markets: http://localhost:${PORT}/markets`);
    console.log(`  💼 Positions: http://localhost:${PORT}/positions`);
    console.log(`  📜 Trades: http://localhost:${PORT}/trades`);
    console.log(`  📋 Performance: http://localhost:${PORT}/performance`);
    console.log(`  🔄 Trigger cycle: POST http://localhost:${PORT}/cycle`);
    console.log(`  📡 Status: http://localhost:${PORT}/status`);
    console.log(`\n`);
  });
}

start().catch(console.error);
