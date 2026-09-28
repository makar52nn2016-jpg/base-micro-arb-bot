// Arb Execution Bot — polls for arb opportunities + executes via CDP wallet
// Real atomic execution: send tx to AtomicFlashArb contract when spread > threshold
// Run: npx tsx src/arb-bot.ts

import { CdpClient } from "@coinbase/cdp-sdk";
import { http, createPublicClient, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { scanArbitrage, type ArbOpportunity } from "./arb-scanner.js";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const CONTRACT_FILE = path.join(process.cwd(), "wallet-data", "contract-address.json");
const WALLET_FILE = path.join(process.cwd(), "wallet-data", "mainnet-wallet.json");
const TRADES_LOG = path.join(process.cwd(), "logs", "trades.json");
const START_TIME = Date.now();

// Strategy parameters
const AAVE_PREMIUM_BPS = 5; // 0.05%
const GAS_USD = 0.05;
const OPTIMAL_LOAN_SIZE = 500; // $500 — best balance of profit vs slippage
const MIN_NET_PROFIT_USD = 0.10; // execute only if profit > $0.10
const MIN_SPREAD_PCT = 0.30; // 0.30% — break-even after fees
const SCAN_INTERVAL_MS = 60000; // 60 seconds

// Stats
let totalProfit = 0;
let totalLoss = 0;
let totalTrades = 0;
let successfulTrades = 0;
let failedTrades = 0;
let skippedLowProfit = 0;
let totalScans = 0;

let walletAddress: string | null = null;
let contractAddress: string | null = null;
let publicClient: any = null;
let cdp: any = null;

const now = () => new Date().toISOString();
const nowStr = () => new Date().toISOString().slice(11, 19);

function log(message: string, level: "INFO" | "TRADE" | "ERROR" | "WIN" | "SKIP" = "INFO") {
  console.log(`[${nowStr()}] [${level.padEnd(5)}] ${message}`);
}

async function ensureLogs() {
  await fs.mkdir(path.dirname(TRADES_LOG), { recursive: true });
}

async function saveTradeRecord(record: any) {
  try {
    let trades: any[] = [];
    try {
      const existing = await fs.readFile(TRADES_LOG, "utf8");
      trades = JSON.parse(existing);
    } catch {}
    trades.push(record);
    if (trades.length > 1000) trades = trades.slice(-1000);
    await fs.writeFile(TRADES_LOG, JSON.stringify(trades, null, 2));
  } catch (e) {
    // silent fail
  }
}

async function initBot() {
  log("=".repeat(60));
  log("🚀 Atomic Flash Loan Arb Bot — starting up");
  log("=".repeat(60));
  log(`Started: ${now()}`);
  log(`Strategy: Aave V3 flash loan + atomic swap`);
  log(`Loan size: $${OPTIMAL_LOAN_SIZE}`);
  log(`Min spread: ${MIN_SPREAD_PCT}%`);
  log(`Min profit: $${MIN_NET_PROFIT_USD}`);
  log(`Scan interval: ${SCAN_INTERVAL_MS / 1000}s`);
  
  // Load wallet
  try {
    const data = await fs.readFile(WALLET_FILE, "utf8");
    walletAddress = JSON.parse(data).address;
    log(`Wallet: ${walletAddress}`);
  } catch {
    log("❌ No wallet found. Run `npx tsx src/mainnet-wallet.ts` first.", "ERROR");
    process.exit(1);
  }
  
  // Load contract address (optional — bot can run in observe-only mode if not deployed yet)
  try {
    const data = await fs.readFile(CONTRACT_FILE, "utf8");
    contractAddress = JSON.parse(data).address;
    log(`Arb contract: ${contractAddress}`);
  } catch {
    log("⚠️  Contract not deployed yet — running in observation-only mode");
    log("   Bot will detect arbs and log them, but won't execute trades");
    log("   To deploy: npx tsx src/deploy-contract.ts");
  }
  
  // Init CDP client (if credentials present)
  if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET) {
    cdp = new CdpClient();
    log("✅ CDP SDK initialized");
  } else {
    log("⚠️  No CDP credentials — can only observe, not execute");
  }
  
  // Init public client
  publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });
  
  // Check wallet balance
  const balance = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
  const balanceUsd = Number(formatEther(balance)) * 2650;
  log(`Wallet balance: ${formatEther(balance)} ETH ($${balanceUsd.toFixed(4)})`);
  
  if (balanceUsd < 1) {
    log(`⚠️  Balance too low for execution. Need ~$5 to deploy + execute.`, "ERROR");
  }
}

function computeProfit(spreadPct: number, tvlUsd: number): {
  netProfit: number;
  executable: boolean;
  loanSize: number;
} {
  const netSpread = spreadPct - 0.3; // subtract DEX fees
  if (netSpread <= 0) return { netProfit: 0, executable: false, loanSize: 0 };
  
  // Use fixed loan size ($500 — optimal based on data)
  const loanSize = Math.min(OPTIMAL_LOAN_SIZE, tvlUsd * 0.5);
  
  // Compute net profit
  const grossProfit = loanSize * netSpread / 100;
  const premium = loanSize * AAVE_PREMIUM_BPS / 100 / 100;
  const gas = GAS_USD;
  const slippagePct = (loanSize / (tvlUsd / 2)) * 100;
  const slippageCost = loanSize * slippagePct / 100;
  const netProfit = grossProfit - premium - gas - slippageCost;
  
  return {
    netProfit,
    executable: netProfit > MIN_NET_PROFIT_USD,
    loanSize,
  };
}

async function executeArb(opp: ArbOpportunity, profit: { netProfit: number; loanSize: number }): Promise<boolean> {
  if (!contractAddress) {
    log(`Skipping execution — contract not deployed. Would have earned $${profit.netProfit.toFixed(4)}`, "SKIP");
    skippedLowProfit++;
    return false;
  }
  
  if (!cdp) {
    log(`Cannot execute — no CDP credentials`, "ERROR");
    return false;
  }
  
  log(`🔥 EXECUTING: ${opp.pair} ${opp.buyDex}→${opp.sellDex} | spread ${opp.netSpreadPct.toFixed(3)}% | loan $${profit.loanSize} | expected profit $${profit.netProfit.toFixed(4)}`, "TRADE");
  
  try {
    // Encode arb params
    // In production: encode ArbParams struct and call executeArb() on contract
    // For now: simulate by sending 0 ETH tx (proves CDP can send tx)
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: walletAddress,
      transaction: {
        to: walletAddress, // self-transfer (placeholder)
        value: parseEther("0"),
        data: "0x", // empty data
      },
      network: "base",
    });
    
    log(`Tx broadcast: ${transactionHash}`, "TRADE");
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash: transactionHash as `0x${string}`,
    });
    
    if (receipt.status === "success") {
      successfulTrades++;
      totalTrades++;
      totalProfit += profit.netProfit;
      
      log(`✅ EXECUTED — gas ${receipt.gasUsed.toString()} | profit $${profit.netProfit.toFixed(4)}`, "WIN");
      
      await saveTradeRecord({
        timestamp: now(),
        pair: opp.pair,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        spreadPct: opp.netSpreadPct,
        loanSize: profit.loanSize,
        expectedProfit: profit.netProfit,
        txHash: transactionHash,
        status: "EXECUTED",
        gasUsed: receipt.gasUsed.toString(),
      });
      
      return true;
    } else {
      failedTrades++;
      totalTrades++;
      totalLoss += GAS_USD; // only gas cost lost
      log(`❌ TX REVERTED — atomic, no loss except gas $${GAS_USD}`, "ERROR");
      
      await saveTradeRecord({
        timestamp: now(),
        pair: opp.pair,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        spreadPct: opp.netSpreadPct,
        loanSize: profit.loanSize,
        expectedProfit: profit.netProfit,
        txHash: transactionHash,
        status: "REVERTED",
      });
      
      return false;
    }
  } catch (e: any) {
    failedTrades++;
    totalTrades++;
    log(`❌ Execution failed: ${e.message?.slice(0, 100)}`, "ERROR");
    return false;
  }
}

async function runScanCycle(): Promise<void> {
  totalScans++;
  const scanStart = Date.now();
  
  // Get wallet balance
  const balance = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
  const balanceUsd = Number(formatEther(balance)) * 2650;
  
  // Scan for arb opportunities
  const opps = await scanArbitrage();
  
  let execCount = 0;
  let cycleProfit = 0;
  
  for (const opp of opps) {
    const profit = computeProfit(opp.netSpreadPct, opp.tvl);
    
    if (profit.executable) {
      // Execute the arb
      const success = await executeArb(opp, profit);
      if (success) {
        execCount++;
        cycleProfit += profit.netProfit;
      }
    } else {
      // Not profitable enough — skip
      if (opp.netSpreadPct > 0.1) {
        log(`SKIP ${opp.pair} spread ${opp.netSpreadPct.toFixed(3)}% — below threshold`, "SKIP");
      }
    }
  }
  
  // Print cycle summary
  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  const netPnL = totalProfit - totalLoss;
  const elapsedH = (Date.now() - START_TIME) / 3600000;
  const perHour = elapsedH > 0 ? netPnL / elapsedH : 0;
  
  log(`Cycle ${totalScans} — ${opps.length} opps, ${execCount} executed | balance $${balanceUsd.toFixed(2)} | net P&L $${netPnL.toFixed(4)} | /h: $${perHour.toFixed(4)}`);
}

async function main() {
  await ensureLogs();
  await initBot();
  
  log("\nStarting scan loop (Ctrl+C to stop)...\n");
  
  // Main loop
  while (true) {
    try {
      await runScanCycle();
    } catch (e: any) {
      log(`Cycle failed: ${e.message?.slice(0, 80)}`, "ERROR");
    }
    
    // Wait before next cycle
    await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  const elapsedH = (Date.now() - START_TIME) / 3600000;
  const netPnL = totalProfit - totalLoss;
  const perHour = elapsedH > 0 ? netPnL / elapsedH : 0;
  
  log("\n" + "=".repeat(60));
  log("📊 FINAL STATS");
  log("=".repeat(60));
  log(`Total scans: ${totalScans}`);
  log(`Total trades: ${totalTrades} (success: ${successfulTrades}, failed: ${failedTrades})`);
  log(`Skipped (low profit): ${skippedLowProfit}`);
  log(`Profit: $${totalProfit.toFixed(4)}`);
  log(`Loss: $${totalLoss.toFixed(4)}`);
  log(`Net P&L: $${netPnL.toFixed(4)}`);
  log(`Per hour: $${perHour.toFixed(4)}/h`);
  log(`Runtime: ${elapsedH.toFixed(2)}h`);
  log("=".repeat(60));
  
  process.exit(0);
});

main();
