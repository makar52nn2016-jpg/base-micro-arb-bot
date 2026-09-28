// Real market analysis — runs 10 cycles, captures real arb opportunities
// No CDP wallet needed — just reads on-chain state via Alchemy RPC

import { scanArbitrage, type ArbOpportunity } from "./src/arb-scanner.js";

const AAVE_PREMIUM_BPS = 5; // 0.05%
const GAS_USD = 0.05;
const LOAN_SIZES = [50, 100, 200, 500, 1000, 2000, 5000];

interface CycleResult {
  cycle: number;
  timestamp: string;
  opportunities: ArbOpportunity[];
  executableCount: number;
  totalPotentialProfit: number;
}

function computeProfit(spreadPct: number, tvlUsd: number) {
  const netSpread = spreadPct - 0.3; // subtract DEX fees
  if (netSpread <= 0) return { best: 0, bestNet: 0, executable: false };
  
  let best = 0, bestNet = -Infinity;
  for (const ls of LOAN_SIZES) {
    if (ls > tvlUsd * 0.5) continue;
    const gross = ls * netSpread / 100;
    const premium = ls * AAVE_PREMIUM_BPS / 100 / 100;
    const gas = GAS_USD;
    const slippagePct = (ls / (tvlUsd / 2)) * 100;
    const slippageCost = ls * slippagePct / 100;
    const net = gross - premium - gas - slippageCost;
    if (net > bestNet) { bestNet = net; best = ls; }
  }
  return { best, bestNet, executable: bestNet > 0.001 };
}

async function runRealAnalysis() {
  console.log("=".repeat(70));
  console.log("📊 REAL MARKET ANALYSIS — 10 cycles, 60s apart");
  console.log("=".repeat(70));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Strategy: Aave V3 flash loan + atomic swap`);
  console.log(`Loan sizes tested: ${LOAN_SIZES.join(", ")}`);
  console.log(`Premium: ${AAVE_PREMIUM_BPS/100}% | Gas: $${GAS_USD}`);
  console.log("=".repeat(70));
  console.log();

  const results: CycleResult[] = [];
  let totalExec = 0;
  let totalProfit = 0;
  const byPair: Record<string, { count: number; exec: number; maxProfit: number; avgSpread: number }> = {};
  const byDex: Record<string, { count: number; exec: number }> = {};

  for (let cycle = 1; cycle <= 10; cycle++) {
    const cycleStart = Date.now();
    const opportunities = await scanArbitrage();
    
    let execCount = 0;
    let cycleProfit = 0;
    
    for (const opp of opportunities) {
      const p = computeProfit(opp.netSpreadPct, opp.tvl);
      
      const pairKey = opp.pair;
      if (!byPair[pairKey]) byPair[pairKey] = { count: 0, exec: 0, maxProfit: 0, avgSpread: 0 };
      byPair[pairKey].count++;
      byPair[pairKey].avgSpread += opp.netSpreadPct;
      
      const dexKey = `${opp.buyDex}→${opp.sellDex}`;
      if (!byDex[dexKey]) byDex[dexKey] = { count: 0, exec: 0 };
      byDex[dexKey].count++;
      
      if (p.executable) {
        execCount++;
        cycleProfit += p.bestNet;
        totalExec++;
        totalProfit += p.bestNet;
        byPair[pairKey].exec++;
        byPair[pairKey].maxProfit = Math.max(byPair[pairKey].maxProfit, p.bestNet);
        byDex[dexKey].exec++;
        console.log(`[C${cycle.toString().padStart(2)}] ✅ EXEC ${opp.pair.padEnd(12)} ${opp.buyDex.padEnd(11)}→${opp.sellDex.padEnd(11)} spread ${opp.netSpreadPct.toFixed(3)}% TVL $${opp.tvl.toFixed(0)} loan $${p.best} net $${p.bestNet.toFixed(4)}`);
      } else {
        // Show non-executable for context
        if (opp.netSpreadPct > 0.1) {
          console.log(`[C${cycle.toString().padStart(2)}] ❌ skip ${opp.pair.padEnd(12)} ${opp.buyDex.padEnd(11)}→${opp.sellDex.padEnd(11)} spread ${opp.netSpreadPct.toFixed(3)}% TVL $${opp.tvl.toFixed(0)} net $${p.bestNet.toFixed(4)}`);
        }
      }
    }
    
    results.push({
      cycle,
      timestamp: new Date().toISOString(),
      opportunities,
      executableCount: execCount,
      totalPotentialProfit: cycleProfit,
    });
    
    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    if (execCount === 0 && opportunities.length > 0) {
      console.log(`[C${cycle.toString().padStart(2)}] ${opportunities.length} spreads, 0 executable (${elapsed}s)`);
    } else if (opportunities.length === 0) {
      console.log(`[C${cycle.toString().padStart(2)}] No spreads detected (${elapsed}s)`);
    }
    
    if (cycle < 10) await new Promise(r => setTimeout(r, 60000)); // 60s between cycles
  }

  // Final analysis
  console.log("\n" + "=".repeat(70));
  console.log("📊 REAL MARKET ANALYSIS — FINAL RESULTS");
  console.log("=".repeat(70));
  console.log(`Runtime: 10 minutes (10 cycles × 60s)`);
  console.log(`Total executable arbs found: ${totalExec}`);
  console.log(`Total net profit if executed: $${totalProfit.toFixed(4)}`);
  console.log(`Average per hour: $${(totalProfit * 6).toFixed(4)}/hour (10min × 6 = 1h)`);
  console.log(`Average per day: $${(totalProfit * 6 * 24).toFixed(2)}/day`);
  
  console.log("\n--- By pair ---");
  const sortedPairs = Object.entries(byPair).sort((a, b) => b[1].exec - a[1].exec);
  for (const [pair, d] of sortedPairs) {
    const avgSpread = (d.avgSpread / d.count).toFixed(3);
    console.log(`  ${pair.padEnd(15)} | scans=${d.count} | exec=${d.exec} | avgSpread=${avgSpread}% | maxNet=$${d.maxProfit.toFixed(4)}`);
  }
  
  console.log("\n--- By DEX route ---");
  const sortedDex = Object.entries(byDex).sort((a, b) => b[1].exec - a[1].exec);
  for (const [route, d] of sortedDex) {
    console.log(`  ${route.padEnd(25)} | scans=${d.count} | exec=${d.exec}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("REALISTIC PROFIT PROJECTION");
  console.log("=".repeat(70));
  
  const perHourTheoretical = totalProfit * 6;
  const perHourWithMEV50 = perHourTheoretical * 0.5; // 50% MEV competition
  const perHourWithMEV70 = perHourTheoretical * 0.3; // 70% MEV competition
  
  console.log(`Theoretical (no MEV competition): $${perHourTheoretical.toFixed(4)}/hour`);
  console.log(`With 50% MEV competition: $${perHourWithMEV50.toFixed(4)}/hour`);
  console.log(`With 70% MEV competition: $${perHourWithMEV70.toFixed(4)}/hour`);
  console.log();
  console.log(`Target: $6/hour`);
  console.log(`Achievable with current bot: ${perHourWithMEV50 >= 6 ? "✅ YES" : perHourWithMEV50 >= 3 ? "⚠ PARTIAL (need optimization)" : "❌ NO — need WebSocket + atomic contract"}`);
  
  console.log("=".repeat(70));
  console.log(`Analysis completed: ${new Date().toISOString()}`);
  console.log("=".repeat(70));
}

runRealAnalysis().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
