import { scanArbitrage } from "./src/arb-scanner.js";

const AAVE_PREMIUM_BPS = 5;
const GAS_USD = 0.05;
const LOAN_SIZES = [50, 100, 200, 500, 1000];

function computeProfit(spreadPct, tvlUsd) {
  const netSpread = spreadPct - 0.3;
  if (netSpread <= 0) return { best: 0, bestNet: 0, executable: false };
  let best = 0, bestNet = -Infinity;
  for (const ls of LOAN_SIZES) {
    if (ls > tvlUsd * 0.5) continue;
    const gross = ls * netSpread / 100;
    const premium = ls * AAVE_PREMIUM_BPS / 100 / 100;
    const slippage = ls * (ls / (tvlUsd / 2)) * 100 / 100;
    const net = gross - premium - GAS_USD - slippage;
    if (net > bestNet) { bestNet = net; best = ls; }
  }
  return { best, bestNet, executable: bestNet > 0.001 };
}

async function main() {
  console.log("=".repeat(70));
  console.log("📊 30 RAPID SCANS (1s apart) — captures real arb frequency");
  console.log("=".repeat(70));
  
  let totalExec = 0;
  let totalProfit = 0;
  const byPair = {};
  const spreadsHistory = [];

  for (let i = 1; i <= 30; i++) {
    const opps = await scanArbitrage();
    let execThis = 0;
    
    for (const o of opps) {
      const p = computeProfit(o.netSpreadPct, o.tvl);
      byPair[o.pair] = byPair[o.pair] || { count: 0, exec: 0, maxNet: 0 };
      byPair[o.pair].count++;
      if (p.executable) {
        byPair[o.pair].exec++;
        byPair[o.pair].maxNet = Math.max(byPair[o.pair].maxNet, p.bestNet);
        totalExec++;
        totalProfit += p.bestNet;
        execThis++;
        spreadsHistory.push({ cycle: i, pair: o.pair, spread: o.netSpreadPct, profit: p.bestNet, loan: p.best });
      }
    }
    
    process.stdout.write(`Cycle ${i.toString().padStart(2)}: ${opps.length} spreads, ${execThis} exec\n`);
    if (i < 30) await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY — 30 cycles (30 seconds of monitoring):");
  console.log("=".repeat(70));
  console.log(`Total cycles: 30`);
  console.log(`Total executable arbs: ${totalExec}`);
  console.log(`Total net profit if executed: $${totalProfit.toFixed(4)}`);
  
  const perMin = totalProfit * 2; // 30 sec → 1 min
  const perHour = perMin * 60;
  const perDay = perHour * 24;
  console.log(`Per minute: $${perMin.toFixed(4)}`);
  console.log(`Per hour (theoretical): $${perHour.toFixed(4)}`);
  console.log(`Per day (theoretical): $${perDay.toFixed(2)}`);
  
  console.log("\nBy pair:");
  for (const [p, d] of Object.entries(byPair)) {
    console.log(`  ${p.padEnd(15)} scans=${d.count} exec=${d.exec} maxNet=$${d.maxNet.toFixed(4)}`);
  }
  
  if (spreadsHistory.length > 0) {
    console.log("\nExecutable arb history:");
    spreadsHistory.forEach(s => {
      console.log(`  Cycle ${s.cycle}: ${s.pair} spread ${s.spread.toFixed(3)}% loan $${s.loan} profit $${s.profit.toFixed(4)}`);
    });
  } else {
    console.log("\n❌ No executable arbs in 30 seconds — confirms polling 1s is too slow");
    console.log("   Need WebSocket + Multicall3 for sub-200ms latency");
  }
  
  console.log("=".repeat(70));
}

main().catch(e => console.error("FATAL:", e));
