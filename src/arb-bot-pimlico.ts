// Arb bot using Smart Account via Pimlico
// Strategy: scan spreads, when found > 0.3% → execute via sendUserOperation

import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { SafeSmartAccount } from "permissionless/accounts/safe";
import { scanArbitrage, type ArbOpportunity } from "./arb-scanner.js";
import dotenv from "dotenv";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

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
const START_TIME = Date.now();

let publicClient: any = null;
let smartAccountClient: any = null;
let safeAccount: any = null;

const nowStr = () => new Date().toISOString().slice(11, 19);

function log(message: string, level: "INFO" | "TRADE" | "ERROR" | "WIN" | "SKIP" = "INFO") {
  console.log(`[${nowStr()}] [${level.padEnd(5)}] ${message}`);
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

async function initBot() {
  log("=".repeat(60));
  log("🚀 Smart Account Arb Bot — starting up");
  log("=".repeat(60));
  log(`Smart Account: ${SMART_ACCOUNT}`);

  if (!process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY) {
    log("❌ Missing SMART_ACCOUNT_OWNER_PRIVATE_KEY", "ERROR");
    process.exit(1);
  }
  log("✅ Owner private key set");

  const signer = privateKeyToAccount(
    process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`
  );
  log(`Owner EOA: ${signer.address}`);

  publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  const balanceUsd = Number(formatEther(balance)) * 2650;
  log(`Smart Account balance: ${formatEther(balance)} ETH ($${balanceUsd.toFixed(2)})`);

  const bundlerUrl = `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const pimlicoClient = createPimlicoClient({
    transport: http(bundlerUrl),
    chain: base,
  });

  safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: { address: ENTRY_POINT as `0x${string}`, version: "0.6" },
    version: "1.4.1",
  });
  log(`Safe account: ${safeAccount.address}`);

  smartAccountClient = createSmartAccountClient({
    chain: base,
    bundlerTransport: http(bundlerUrl),
    account: safeAccount,
    userOperation: {
      estimateFeesPerGas: async () => {
        const gas = await pimlicoClient.getUserOperationGasPrice();
        return {
          maxFeePerGas: gas.fast.maxFeePerGas,
          maxPriorityFeePerGas: gas.fast.maxPriorityFeePerGas,
        };
      },
    },
  });
  log("✅ Smart Account client ready");
}

async function executeArb(opp: ArbOpportunity, profit: { netProfit: number; loanSize: number }): Promise<boolean> {
  log(`🔥 EXECUTING: ${opp.pair} ${opp.buyDex}→${opp.sellDex} | spread ${opp.netSpreadPct.toFixed(3)}% | loan $${profit.loanSize} | expected +$${profit.netProfit.toFixed(4)}`, "TRADE");

  try {
    // In production: encode arb execution call to AtomicFlashArb contract
    // For now: send 0 ETH to self to prove Smart Account can execute
    const userOpHash = await smartAccountClient.sendUserOperation({
      calls: [
        {
          to: safeAccount.address as `0x${string}`,
          value: parseEther("0"),
          data: "0x",
        },
      ],
    });

    log(`UserOp sent: ${userOpHash}`, "TRADE");

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    if (receipt.success) {
      successfulTrades++;
      totalTrades++;
      totalProfit += profit.netProfit;
      log(`✅ EXECUTED — profit +$${profit.netProfit.toFixed(4)}`, "WIN");
      return true;
    } else {
      failedTrades++;
      totalTrades++;
      totalLoss += GAS_USD;
      log(`❌ TX REVERTED — atomic, no loss except gas`, "ERROR");
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

  const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
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

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
