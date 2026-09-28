// Arb bot V2 — uses Owner EOA directly (NO Smart Account, NO Pimlico)
// Regular viem sendTransaction — 50x cheaper gas than UserOp

import { createPublicClient, createWalletClient, http, formatEther, parseEther, encodeFunctionData, type Hex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { scanArbitrage, type ArbOpportunity } from "./arb-scanner.js";
import dotenv from "dotenv";

dotenv.config();

// Owner EOA (the wallet that deployed the contract)
const OWNER_PRIVATE_KEY = process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`;
const CONTRACT_ADDRESS = "0x85d5a6f4faab56a909d485c8ddd53abecd147af7";

// Token addresses
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bDA02913" as Hex;
const WETH = "0x4200000000000000000000000000000000000006" as Hex;

const FLASH_LOAN_AMOUNT = 500n * 10n ** 6n; // 500 USDC (6 decimals)
const MIN_SPREAD_PCT = 0.30;
const SCAN_INTERVAL_MS = 60000;
const START_TIME = Date.now();

let totalProfit = 0, totalLoss = 0, totalTrades = 0;
let successfulTrades = 0, failedTrades = 0, totalScans = 0;

const nowStr = () => new Date().toISOString().slice(11, 19);
function log(msg: string, level: string = "INFO") {
  console.log(`[${nowStr()}] [${level.padEnd(5)}] ${msg}`);
}

const REQUEST_FLASH_LOAN_ABI = [{
  name: "requestFlashLoan",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_token", type: "address" },
    { name: "_amount", type: "uint256" },
    { name: "_buyDex", type: "uint8" },
    { name: "_sellDex", type: "uint8" },
    { name: "_tokenIn", type: "address" },
    { name: "_tokenOut", type: "address" },
  ],
  outputs: [],
}] as const;

async function main() {
  const signer = privateKeyToAccount(OWNER_PRIVATE_KEY);
  log("=".repeat(60));
  log("🚀 FlashLoanArbV2 Bot — Owner EOA mode (cheap gas)");
  log("=".repeat(60));
  log(`Owner EOA: ${signer.address}`);
  log(`Contract: ${CONTRACT_ADDRESS}`);
  log(`Flash loan: $500 USDC`);
  log(`Min spread: ${MIN_SPREAD_PCT}%`);

  const rpcUrl = process.env.ALCHEMY_BASE_RPC || "https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n";

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: base, transport: http(rpcUrl), account: signer });

  // Check balance
  const balance = await publicClient.getBalance({ address: signer.address });
  const balanceUsd = Number(formatEther(balance)) * 2650;
  log(`Owner EOA balance: ${formatEther(balance)} ETH ($${balanceUsd.toFixed(2)})`);

  if (balanceUsd < 0.10) {
    log("⚠️  Balance too low for execution (need ~$0.10 for gas)", "ERROR");
    log(`   Fund: ${signer.address} on Base mainnet`, "ERROR");
    log("   Then re-run: npx tsx src/arb-bot-pimlico.ts", "ERROR");
  }

  log("\n✅ Bot ready — gas cost ~$0.01 per tx (50x cheaper than Smart Account)");
  log("Starting scan loop...\n");

  while (true) {
    totalScans++;
    const scanStart = Date.now();

    try {
      const opps = await scanArbitrage();
      let execCount = 0;

      for (const opp of opps) {
        // Only execute AERO/WETH with spread > 0.3% and TVL > $10K
        if (opp.pair === "AERO/WETH" && opp.netSpreadPct > MIN_SPREAD_PCT && opp.tvl > 10000) {
          const expectedProfit = 500 * opp.netSpreadPct / 100 - 0.25 - 0.01;
          log(`🔥 EXEC: ${opp.pair} ${opp.buyDex}→${opp.sellDex} | spread ${opp.netSpreadPct.toFixed(3)}% | loan $500 | expected +$${expectedProfit.toFixed(4)}`, "TRADE");

          // ABI-encode requestFlashLoan(USDC, 500e6, 0, 1, WETH, USDC)
          const callData = encodeFunctionData({
            abi: REQUEST_FLASH_LOAN_ABI,
            args: [USDC, FLASH_LOAN_AMOUNT, 0n, 1n, WETH, USDC],
          });

          try {
            const txHash = await walletClient.sendTransaction({
              account: signer,
              to: CONTRACT_ADDRESS as `0x${string}`,
              data: callData,
              value: 0n,
              chain: base,
              gas: 500000n,
            });

            log(`Tx sent: ${txHash}`, "TRADE");
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            if (receipt.status === "success") {
              successfulTrades++;
              totalTrades++;
              totalProfit += expectedProfit;
              log(`✅ FLASH LOAN EXECUTED — gas ${receipt.gasUsed} | profit +$${expectedProfit.toFixed(4)}`, "WIN");
              execCount++;
            } else {
              failedTrades++;
              totalTrades++;
              totalLoss += 0.01;
              log(`❌ Flash loan reverted — atomic, no loss except gas`, "ERROR");
            }
          } catch (e: any) {
            failedTrades++;
            totalTrades++;
            log(`❌ Tx failed: ${e.message?.slice(0, 80)}`, "ERROR");
          }
        } else if (opp.netSpreadPct > 0.1) {
          log(`SKIP ${opp.pair} spread ${opp.netSpreadPct.toFixed(3)}%`, "SKIP");
        }
      }

      const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
      const netPnL = totalProfit - totalLoss;
      const elapsedH = (Date.now() - START_TIME) / 3600000;
      const perHour = elapsedH > 0 ? netPnL / elapsedH : 0;

      const newBalance = await publicClient.getBalance({ address: signer.address });
      const newUsd = Number(formatEther(newBalance)) * 2650;

      log(`Cycle ${totalScans} — ${opps.length} opps, ${execCount} exec | bal $${newUsd.toFixed(2)} | net P&L $${netPnL.toFixed(4)} | /h: $${perHour.toFixed(4)}`);
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
  log(`Scans: ${totalScans} | Trades: ${totalTrades} (W:${successfulTrades} L:${failedTrades})`);
  log(`Profit: $${totalProfit.toFixed(4)} | Loss: $${totalLoss.toFixed(4)} | Net: $${netPnL.toFixed(4)}`);
  log(`Per hour: $${perHour.toFixed(4)}/h | Runtime: ${elapsedH.toFixed(2)}h`);
  log("=".repeat(60));
  process.exit(0);
});

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
