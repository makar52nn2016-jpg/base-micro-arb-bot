// Data Collection Bot — measures REAL arb spreads on Base 24/7
// Goal: collect 24-48h of data to validate flash loan strategy
//
// What it measures every 60 seconds:
//   - 10 pairs × 3 DEXes = 30 price points
//   - All cross-DEX spreads (3 per pair = 30 spreads)
//   - Records timestamp, pair, spread %, TVL
//   - Computes theoretical flash loan profit
//
// Output: JSONL log in logs/spreads.jsonl
//   {"ts":"2026-09-28T...","pair":"WETH/USDC","buyDex":"Aerodrome","sellDex":"Uniswap","spread":0.42,"netSpread":0.37,"tvl":45000,"loanSize":1000,"grossProfit":4.2,"premium":0.5,"gas":0.05,"netProfit":3.65}
//
// Run: npx tsx src/data-collector.ts

import { scanArbitrage, type ArbOpportunity } from "./arb-scanner.js";
import { initCDP, getBalance } from "./cdp-client.js";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const LOG_FILE = path.join(process.cwd(), "logs", "spreads.jsonl");
const STATS_FILE = path.join(process.cwd(), "logs", "stats.json");
const START_TIME = Date.now();

const AAVE_FLASHLOAN_PREMIUM_BPS = 5; // 0.05% on Base (verified)
const GAS_COST_USD = 0.05; // Base typical gas for swap tx
const LOAN_SIZES_USD = [50, 100, 200, 500, 1000, 2000, 5000]; // test multiple sizes
const MIN_PROFIT_THRESHOLD_USD = 0.001; // 0.1 cent minimum

interface SpreadRecord {
  ts: string;
  pair: string;
  buyDex: string;
  sellDex: string;
  spreadPct: number;
  netSpreadPct: number; // after DEX fees (0.3%)
  tvl: number;
  bestLoanSize: number;
  bestNetProfit: number;
  allLoanSizes: { loanSize: number; netProfit: number; executable: boolean }[];
  executable: boolean;
}

interface Stats {
  totalScans: number;
  totalSpreadsDetected: number;
  executableArbs: number;
  byPair: Record<string, { count: number; avgNetProfit: number; maxNetProfit: number; executableCount: number }>;
  byHour: Record<number, { count: number; executableCount: number; totalNetProfit: number }>;
  startTime: string;
  lastScanTime: string;
  totalNetProfitIfExecuted: number;
  avgProfitPerHour: number;
  bestPair: string | null;
  bestHour: number | null;
}

let stats: Stats = {
  totalScans: 0,
  totalSpreadsDetected: 0,
  executableArbs: 0,
  byPair: {},
  byHour: {},
  startTime: new Date().toISOString(),
  lastScanTime: "",
  totalNetProfitIfExecuted: 0,
  avgProfitPerHour: 0,
  bestPair: null,
  bestHour: null,
};

async function ensureLogDirs() {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
}

async function loadStats() {
  try {
    const existing = await fs.readFile(STATS_FILE, "utf8");
    stats = JSON.parse(existing);
    console.log(`[DATA] Loaded existing stats: ${stats.totalScans} scans, ${stats.executableArbs} executable arbs`);
  } catch {
    // No existing stats — fresh start
  }
}

async function saveStats() {
  // Compute final stats
  const elapsedH = (Date.now() - START_TIME) / 3600000;
  stats.avgProfitPerHour = elapsedH > 0 ? stats.totalNetProfitIfExecuted / elapsedH : 0;

  // Find best pair by total net profit
  let bestPair: string | null = null;
  let bestPairProfit = -Infinity;
  for (const [pair, data] of Object.entries(stats.byPair)) {
    const totalProfit = data.avgNetProfit * data.count;
    if (totalProfit > bestPairProfit) {
      bestPairProfit = totalProfit;
      bestPair = pair;
    }
  }
  stats.bestPair = bestPair;

  // Find best hour
  let bestHour: number | null = null;
  let bestHourProfit = -Infinity;
  for (const [hour, data] of Object.entries(stats.byHour)) {
    if (data.totalNetProfit > bestHourProfit) {
      bestHourProfit = data.totalNetProfit;
      bestHour = parseInt(hour);
    }
  }
  stats.bestHour = bestHour;

  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

async function logSpread(record: SpreadRecord) {
  await fs.appendFile(LOG_FILE, JSON.stringify(record) + "\n");
}

function computeFlashLoanProfit(spreadPct: number, tvlUsd: number): {
  bestLoanSize: number;
  bestNetProfit: number;
  allLoanSizes: { loanSize: number; netProfit: number; executable: boolean }[];
  executable: boolean;
} {
  // Net spread after DEX fees (both DEXes charge ~0.3%)
  const netSpread = spreadPct - 0.3;
  if (netSpread <= 0) {
    return { bestLoanSize: 0, bestNetProfit: 0, allLoanSizes: [], executable: false };
  }

  // Test multiple loan sizes
  const allLoanSizes: { loanSize: number; netProfit: number; executable: boolean }[] = [];
  let bestLoanSize = 0;
  let bestNetProfit = -Infinity;

  for (const loanSize of LOAN_SIZES_USD) {
    // Skip if loan > 50% of pool TVL (would cause massive slippage)
    if (loanSize > tvlUsd * 0.5) continue;

    // Gross profit = loan × net spread %
    const grossProfit = loanSize * netSpread / 100;

    // Aave premium: 0.05% of loan
    const premium = loanSize * AAVE_FLASHLOAN_PREMIUM_BPS / 100 / 100;

    // Gas cost (entry + exit + flash loan callback)
    const gas = GAS_COST_USD;

    // Slippage: loan / (tvl/2) * 100% (constant product formula)
    const slippagePct = (loanSize / (tvlUsd / 2)) * 100;
    const slippageCost = loanSize * slippagePct / 100;

    const netProfit = grossProfit - premium - gas - slippageCost;
    const executable = netProfit > MIN_PROFIT_THRESHOLD_USD;

    allLoanSizes.push({ loanSize, netProfit, executable });

    if (netProfit > bestNetProfit) {
      bestNetProfit = netProfit;
      bestLoanSize = loanSize;
    }
  }

  const executable = bestNetProfit > MIN_PROFIT_THRESHOLD_USD;

  return { bestLoanSize, bestNetProfit, allLoanSizes, executable };
}

async function runCollectionCycle() {
  stats.totalScans++;
  const scanStart = Date.now();

  const opportunities = await scanArbitrage();
  const now = new Date();
  const hour = now.getUTCHours();

  if (!stats.byHour[hour]) {
    stats.byHour[hour] = { count: 0, executableCount: 0, totalNetProfit: 0 };
  }
  stats.byHour[hour].count++;

  for (const opp of opportunities) {
    stats.totalSpreadsDetected++;

    const profit = computeFlashLoanProfit(opp.netSpreadPct, opp.tvl);

    const record: SpreadRecord = {
      ts: now.toISOString(),
      pair: opp.pair,
      buyDex: opp.buyDex,
      sellDex: opp.sellDex,
      spreadPct: opp.spreadPct,
      netSpreadPct: opp.netSpreadPct,
      tvl: opp.tvl,
      bestLoanSize: profit.bestLoanSize,
      bestNetProfit: profit.bestNetProfit,
      allLoanSizes: profit.allLoanSizes,
      executable: profit.executable,
    };

    await logSpread(record);

    if (profit.executable) {
      stats.executableArbs++;
      stats.totalNetProfitIfExecuted += profit.bestNetProfit;
      stats.byHour[hour].executableCount++;
      stats.byHour[hour].totalNetProfit += profit.bestNetProfit;
    }

    // Update byPair stats
    if (!stats.byPair[opp.pair]) {
      stats.byPair[opp.pair] = { count: 0, avgNetProfit: 0, maxNetProfit: 0, executableCount: 0 };
    }
    const pairStats = stats.byPair[opp.pair];
    pairStats.count++;
    pairStats.avgNetProfit = (pairStats.avgNetProfit * (pairStats.count - 1) + profit.bestNetProfit) / pairStats.count;
    pairStats.maxNetProfit = Math.max(pairStats.maxNetProfit, profit.bestNetProfit);
    if (profit.executable) pairStats.executableCount++;
  }

  stats.lastScanTime = now.toISOString();
  await saveStats();

  const elapsedSec = (Date.now() - scanStart) / 1000;
  if (opportunities.length > 0) {
    const execCount = opportunities.filter(o => {
      const p = computeFlashLoanProfit(o.netSpreadPct, o.tvl);
      return p.executable;
    }).length;
    console.log(`[SCAN ${stats.totalScans}] ${opportunities.length} spreads detected, ${execCount} executable | ${elapsedSec.toFixed(1)}s`);
  } else {
    console.log(`[SCAN ${stats.totalScans}] No spreads | ${elapsedSec.toFixed(1)}s`);
  }
}

async function printSummary() {
  const elapsedH = (Date.now() - START_TIME) / 3600000;
  console.log("\n" + "=".repeat(60));
  console.log("📊 DATA COLLECTION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Runtime: ${elapsedH.toFixed(2)}h`);
  console.log(`Total scans: ${stats.totalScans} (one per minute)`);
  console.log(`Spreads detected: ${stats.totalSpreadsDetected}`);
  console.log(`Executable arbs (after premium + gas + slippage): ${stats.executableArbs}`);
  console.log(`Total net profit IF executed: $${stats.totalNetProfitIfExecuted.toFixed(4)}`);
  console.log(`Average profit per hour: $${stats.avgProfitPerHour.toFixed(4)}/h`);

  console.log("\n--- Top pairs by average net profit ---");
  const sortedPairs = Object.entries(stats.byPair)
    .sort((a, b) => b[1].avgNetProfit - a[1].avgNetProfit)
    .slice(0, 5);
  for (const [pair, data] of sortedPairs) {
    console.log(`  ${pair.padEnd(15)} | scans=${data.count} | avgNet=$${data.avgNetProfit.toFixed(4)} | maxNet=$${data.maxNetProfit.toFixed(4)} | exec=${data.executableCount}`);
  }

  console.log("\n--- Profitable hours (UTC) ---");
  const sortedHours = Object.entries(stats.byHour)
    .filter(([_, data]) => data.executableCount > 0)
    .sort((a, b) => b[1].totalNetProfit - a[1].totalNetProfit);
  if (sortedHours.length === 0) {
    console.log("  (no profitable hours yet — need more data)");
  } else {
    for (const [hour, data] of sortedHours.slice(0, 8)) {
      console.log(`  ${hour.padStart(2, '0')}:00 UTC | scans=${data.count} | exec=${data.executableCount} | totalNet=$${data.totalNetProfit.toFixed(4)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Best pair: ${stats.bestPair || 'none yet'}`);
  console.log(`Best hour: ${stats.bestHour !== null ? stats.bestHour + ':00 UTC' : 'none yet'}`);
  console.log(`Logs: ${LOG_FILE}`);
  console.log(`Stats: ${STATS_FILE}`);
  console.log("=".repeat(60));
}

async function main() {
  await ensureLogDirs();
  await loadStats();

  console.log("=".repeat(60));
  console.log("📊 Base Arb Data Collector");
  console.log("=".repeat(60));
  console.log(`Strategy: Monitor spreads every 60s`);
  console.log(`Pairs: 10 × 3 DEXes = 30 cross-DEX paths`);
  console.log(`Flash loan: testing sizes [${LOAN_SIZES_USD.join(", ")}]`);
  console.log(`Premium: ${AAVE_FLASHLOAN_PREMIUM_BPS/100}% (Aave V3)`);
  console.log(`Gas: $${GAS_COST_USD}`);
  console.log(`Min profit threshold: $${MIN_PROFIT_THRESHOLD_USD}`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log("=".repeat(60));

  // Optional CDP wallet init (just for balance display)
  try {
    await initCDP();
    const { usd } = await getBalance();
    console.log(`Wallet balance: $${usd.toFixed(4)}`);
  } catch (e: any) {
    console.log(`Wallet not configured: ${e.message?.slice(0, 60)}`);
    console.log(`Bot will run in observation-only mode (no execution)`);
  }

  console.log("\nStarting data collection loop...\n");

  // Print summary every 10 scans
  let summaryCounter = 0;

  // Main loop
  while (true) {
    try {
      await runCollectionCycle();
      summaryCounter++;
      if (summaryCounter % 10 === 0) {
        await printSummary();
      }
    } catch (e: any) {
      console.error(`[ERROR] Cycle failed: ${e.message?.slice(0, 80)}`);
    }
    // Wait 60 seconds
    await new Promise(r => setTimeout(r, 60000));
  }
}

process.on("SIGINT", async () => {
  await printSummary();
  await saveStats();
  process.exit(0);
});

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
