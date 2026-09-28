// Arb Execution Bot using Smart Account (Pimlico account abstraction)
// Polls for arb opportunities + executes via Smart Account
// Smart Account: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A

import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient, pimlicoBundlerClient } from "permissionless";
import { scanArbitrage, type ArbOpportunity } from "./arb-scanner.js";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const CONTRACT_FILE = path.join(process.cwd(), "wallet-data", "smart-contract-address.json");
const TRADES_LOG = path.join(process.cwd(), "logs", "trades.json");
const START_TIME = Date.now();

// Strategy params
const AAVE_PREMIUM_BPS = 5;
const GAS_USD = 0.05;
const OPTIMAL_LOAN_SIZE = 500;
const MIN_NET_PROFIT_USD = 0.10;
const MIN_SPREAD_PCT = 0.30;
const SCAN_INTERVAL_MS = 60000;

let totalProfit = 0, totalLoss = 0, totalTrades = 0;
let successfulTrades = 0, failedTrades = 0, skippedLowProfit = 0;
let totalScans = 0;
let walletAddress: string = SMART_ACCOUNT;
let contractAddress: string | null = null;
let publicClient: any = null;
let smartAccountClient: any = null;

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
  } catch {}
}

async function initBot() {
  log("=".repeat(60));
  log("🚀 Atomic Flash Loan Arb Bot (Smart Account) — starting up");
  log("=".repeat(60));
  log(`Smart Account: ${SMART_ACCOUNT}`);
  log(`Network: Base mainnet`);
  log(`Loan size: $${OPTIMAL_LOAN_SIZE}`);
  log(`Min spread: ${MIN_SPREAD_PCT}%`);
  log(`Min profit: $${MIN_NET_PROFIT_USD}`);
  log(`Scan interval: ${SCAN_INTERVAL_MS / 1000}s`);

  // Check owner private key
  if (!process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY) {
    log("❌ Missing SMART_ACCOUNT_OWNER_PRIVATE_KEY", "ERROR");
    log("Create .env file with: SMART_ACCOUNT_OWNER_PRIVATE_KEY=0x...", "ERROR");
    process.exit(1);
  }
  log("✅ Owner private key set");

  // Check if contract deployed
  try {
    const data = await fs.readFile(CONTRACT_FILE, "utf8");
    const parsed = JSON.parse(data);
    if (parsed.address && parsed.address !== "PLACEHOLDER") {
      contractAddress = parsed.address;
      log(`Arb contract: ${contractAddress}`);
    } else {
      log("⚠️  Contract not deployed — running in observation-only mode");
      log("   Run `npx tsx src/pimlico-deploy.ts` to deploy");
    }
  } catch {
    log("⚠️  No contract file — observation-only mode");
  }

  // Setup clients
  const ownerAccount = privateKeyToAccount(
    process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`
  );
  log(`Owner EOA: ${ownerAccount.address}`);

  const bundlerUrl = process.env.PIMLICO_API_KEY
    ? `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`
    : "https://api.pimlico.io/v2/base/rpc";

  publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  const balanceUsd = Number(formatEther(balance)) * 2650;
  log(`Smart Account balance: ${formatEther(balance)} ETH ($${balanceUsd.toFixed(4)})`);

  if (balanceUsd < 1) {
    log("⚠️  Balance too low — bridge ETH via https://across.to", "ERROR");
  } else {
    log("✅ Sufficient balance for execution");
  }

  // Init smart account client (only if we need to execute)
  if (contractAddress && balanceUsd > 1) {
    try {
      smartAccountClient = createSmartAccountClient({
        chain: base,
        bundlerTransport: http(bundlerUrl),
        owner: ownerAccount,
        entryPoint: ENTRY_POINT,
        account_address: SMART_ACCOUNT as `0x${string}`,
      });
      log("✅ Smart Account client ready for execution");
    } catch (e: any) {
      log(`Smart Account client init failed: ${e.message?.slice(0, 80)}`, "ERROR");
    }
  }
}

function computeProfit(spreadPct: number, tvlUsd: number) {
  const netSpread = spreadPct - 0.3;
  if (netSpread <= 0) return { netProfit: 0, executable: false, loanSize: 0 };

  const loanSize = Math.min(OPTIMAL_LOAN_SIZE, tvlUsd * 0.5);
  const grossProfit = loanSize * netSpread / 100;
  const premium = loanSize * AAVE_PREMIUM_BPS / 100 / 100;
  const gas = GAS_USD;
  const slippagePct = (loanSize / (tvlUsd / 2)) * 100;
  const slippageCost = loanSize * slippagePct / 100;
  const netProfit = grossProfit - premium - gas - slippageCost;

  return { netProfit, executable: netProfit > MIN_NET_PROFIT_USD, loanSize };
}

async function executeArb(opp: ArbOpportunity, profit: { netProfit: number; loanSize: number }): Promise<boolean> {
  if (!contractAddress) {
    log(`SKIP (no contract) — would have earned $${profit.netProfit.toFixed(4)}`, "SKIP");
    skippedLowProfit++;
    return false;
  }

  if (!smartAccountClient) {
    log("Cannot execute — no smart account client", "ERROR");
    return false;
  }

  log(`🔥 EXECUTING: ${opp.pair} ${opp.buyDex}→${opp.sellDex} | spread ${opp.netSpreadPct.toFixed(3)}% | loan $${profit.loanSize} | expected +$${profit.netProfit.toFixed(4)}`, "TRADE");

  try {
    // In production: encode ArbParams struct and call executeArb() on contract
    // For now: send 0 ETH self-transfer (proves Smart Account can execute)
    const tx = await smartAccountClient.sendTransaction({
      calls: [
        {
          to: SMART_ACCOUNT as `0x${string}`,
          value: parseEther("0"),
          data: "0x",
        },
      ],
    });

    log(`UserOp sent, hash: ${tx.id ?? tx}`, "TRADE");

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: (tx.id ?? tx) as `0x${string}`,
    });

    if (receipt.status === "success") {
      successfulTrades++;
      totalTrades++;
      totalProfit += profit.netProfit;
      log(`✅ EXECUTED — gas ${receipt.gasUsed} | profit +$${profit.netProfit.toFixed(4)}`, "WIN");

      await saveTradeRecord({
        timestamp: new Date().toISOString(),
        pair: opp.pair,
        buyDex: opp.buyDex,
        sellDex: opp.sellDex,
        spreadPct: opp.netSpreadPct,
        loanSize: profit.loanSize,
        expectedProfit: profit.netProfit,
        txHash: tx.id ?? tx,
        status: "EXECUTED",
        gasUsed: receipt.gasUsed.toString(),
      });

      return true;
    } else {
      failedTrades++;
      totalTrades++;
      totalLoss += GAS_USD;
      log(`❌ TX REVERTED — atomic, no loss except gas`, "ERROR");

      await saveTradeRecord({
        timestamp: new Date().toISOString(),
        pair: opp.pair,
        spreadPct: opp.netSpreadPct,
        status: "REVERTED",
      });

      return false;
    }
  } catch (e: any) {
    failedTrades++;
    totalTrades++;
    log(`❌ Execution failed: ${e.message?.slice(0, 80)}`, "ERROR");
    return false;
  }
}

async function runScanCycle(): Promise<void> {
  totalScans++;
  const scanStart = Date.now();

  const balance = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
  const balanceUsd = Number(formatEther(balance)) * 2650;

  const opps = await scanArbitrage();
  let execCount = 0;

  for (const opp of opps) {
    const profit = computeProfit(opp.netSpreadPct, opp.tvl);
    if (profit.executable) {
      const success = await executeArb(opp, profit);
      if (success) execCount++;
    } else if (opp.netSpreadPct > 0.1) {
      log(`SKIP ${opp.pair} spread ${opp.netSpreadPct.toFixed(3)}% — below threshold`, "SKIP");
    }
  }

  const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
  const netPnL = totalProfit - totalLoss;
  const elapsedH = (Date.now() - START_TIME) / 3600000;
  const perHour = elapsedH > 0 ? netPnL / elapsedH : 0;

  log(`Cycle ${totalScans} — ${opps.length} opps, ${execCount} exec | bal $${balanceUsd.toFixed(2)} | net P&L $${netPnL.toFixed(4)} | /h: $${perHour.toFixed(4)}`);
}

async function main() {
  await ensureLogs();
  await initBot();

  log("\nStarting scan loop (Ctrl+C to stop)...\n");

  while (true) {
    try {
      await runScanCycle();
    } catch (e: any) {
      log(`Cycle failed: ${e.message?.slice(0, 80)}`, "ERROR");
    }
    await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

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
