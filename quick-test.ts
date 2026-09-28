// Quick inline test — runs 5 scan cycles and prints results
import { scanArbitrage } from "./src/arb-scanner.js";

const AAVE_PREMIUM_BPS = 5; // 0.05%
const GAS_USD = 0.05;
const LOAN_SIZES = [50, 100, 200, 500, 1000, 2000, 5000];

function computeProfit(spreadPct, tvlUsd) {
  const netSpread = spreadPct - 0.3;
  if (netSpread <= 0) return { best: 0, bestNet: 0, executable: false, all: [] };
  
  let best = 0, bestNet = -Infinity;
  const all = [];
  for (const loanSize of LOAN_SIZES) {
    if (loanSize > tvlUsd * 0.5) continue;
    const gross = loanSize * netSpread / 100;
    const premium = loanSize * AAVE_PREMIUM_BPS / 100 / 100;
    const gas = GAS_USD;
    const slippagePct = (loanSize / (tvlUsd / 2)) * 100;
    const slippageCost = loanSize * slippagePct / 100;
    const net = gross - premium - gas - slippageCost;
    const exec = net > 0.001;
    all.push({ loanSize, netProfit: net, executable: exec });
    if (net > bestNet) { bestNet = net; best = loanSize; }
  }
  return { best, bestNet, executable: bestNet > 0.001, all };
}

async function main() {
  console.log("=".repeat(70));
  console.log("📊 AERO/WETH Arb Analysis — 5 cycles, 10s apart");
  console.log("=".repeat(70));

  let totalExec = 0;
  let totalProfit = 0;

  for (let i = 1; i <= 5; i++) {
    const opps = await scanArbitrage();
    console.log(`\n[Cycle ${i}] ${opps.length} spreads detected`);
    
    for (const o of opps) {
      const p = computeProfit(o.netSpreadPct, o.tvl);
      const status = p.executable ? "✅ EXEC" : "❌ skip";
      console.log(`  ${status} ${o.pair.padEnd(12)} ${o.buyDex.padEnd(11)}→${o.sellDex.padEnd(11)} spread ${o.netSpreadPct.toFixed(3)}% TVL $${o.tvl.toFixed(0)} bestLoan $${p.best} net $${p.bestNet.toFixed(4)}`);
      
      if (p.executable) {
        totalExec++;
        totalProfit += p.bestNet;
      }
    }
    
    if (i < 5) await new Promise(r => setTimeout(r, 10000));
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY:");
  console.log(`  Total cycles: 5`);
  console.log(`  Total executable arbs: ${totalExec}`);
  console.log(`  Total net profit if executed: $${totalProfit.toFixed(4)}`);
  console.log(`  Average per hour (if 60 cycles/hour): $${(totalProfit * 12).toFixed(4)}`);
  console.log(`  Average per day: $${(totalProfit * 12 * 24).toFixed(2)}`);
  console.log("=".repeat(70));
}

main().catch(e => console.error("FATAL:", e));
