import { publicClient } from "./cdp-client.js";

const ALCHEMY = "https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n";

// Base chain verified addresses
export const T = {
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  USDT: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  AERO: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
  AAVE: "0x63706e401c06ac8513145b7687a14804d17f814b",
};

export const AERO_F = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
export const UNI_F = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
export const SLIPSTREAM_FACTORIES = [
  "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
  "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a",
  "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
];
export const ZERO = "0x0000000000000000000000000000000000000000";

export interface Pair {
  name: string;
  tokenIn: string;
  tokenOut: string;
  inDec: number;
  outDec: number;
}

export const PAIRS: Pair[] = [
  { name: "WETH/USDC", tokenIn: T.WETH, tokenOut: T.USDC, inDec: 18, outDec: 6 },
  { name: "WETH/USDT", tokenIn: T.WETH, tokenOut: T.USDT, inDec: 18, outDec: 6 },
  { name: "WETH/DAI", tokenIn: T.WETH, tokenOut: T.DAI, inDec: 18, outDec: 18 },
  { name: "USDC/USDT", tokenIn: T.USDC, tokenOut: T.USDT, inDec: 6, outDec: 6 },
  { name: "USDC/DAI", tokenIn: T.USDC, tokenOut: T.DAI, inDec: 6, outDec: 18 },
  { name: "USDT/DAI", tokenIn: T.USDT, tokenOut: T.DAI, inDec: 6, outDec: 18 },
  { name: "AERO/WETH", tokenIn: T.AERO, tokenOut: T.WETH, inDec: 18, outDec: 18 },
  { name: "AERO/USDC", tokenIn: T.AERO, tokenOut: T.USDC, inDec: 18, outDec: 6 },
  { name: "AAVE/WETH", tokenIn: T.AAVE, tokenOut: T.WETH, inDec: 18, outDec: 18 },
  { name: "AAVE/USDC", tokenIn: T.AAVE, tokenOut: T.USDC, inDec: 18, outDec: 6 },
];

const cache = new Map<string, string>();

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(ALCHEMY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to, data }, "latest"],
        id: 1,
      }),
    });
    const j = await r.json();
    if (j.error || !j.result || j.result === "0x") return null;
    return j.result;
  } catch {
    return null;
  }
}

async function getAerodromePrice(pair: Pair): Promise<{ price: number; tvl: number }> {
  for (const stable of [false, true]) {
    const k = `a:${pair.tokenIn}-${pair.tokenOut}-${stable}`;
    if (cache.has(k)) {
      const p = cache.get(k)!;
      if (p !== ZERO) {
        return await readPool(p, pair);
      }
      continue;
    }
    const sh = stable ? "1" : "0";
    const data =
      "0x79bc57d5" +
      pair.tokenIn.toLowerCase().slice(2).padStart(64, "0") +
      pair.tokenOut.toLowerCase().slice(2).padStart(64, "0") +
      "0".repeat(63) + sh;
    const r = await ethCall(AERO_F, data);
    if (!r) { cache.set(k, ZERO); continue; }
    const pool = "0x" + r.slice(-40);
    if (pool === ZERO) { cache.set(k, ZERO); continue; }
    cache.set(k, pool);
    return await readPool(pool, pair);
  }
  return { price: 0, tvl: 0 };
}

async function getUniswapV3Price(pair: Pair): Promise<{ price: number; tvl: number }> {
  for (const fee of [100, 500, 3000, 10000]) {
    const k = `u:${pair.tokenIn}-${pair.tokenOut}-${fee}`;
    if (cache.has(k)) {
      const p = cache.get(k)!;
      if (p !== ZERO) {
        return await readV3Pool(p, pair);
      }
      continue;
    }
    const feeHex = fee.toString(16).padStart(6, "0");
    const data =
      "0x1698ee82" +
      pair.tokenIn.toLowerCase().slice(2).padStart(64, "0") +
      pair.tokenOut.toLowerCase().slice(2).padStart(64, "0") +
      "0".repeat(58) + feeHex;
    const r = await ethCall(UNI_F, data);
    if (!r) continue;
    const pool = "0x" + r.slice(-40);
    if (pool === ZERO) { cache.set(k, ZERO); continue; }
    cache.set(k, pool);
    return await readV3Pool(pool, pair);
  }
  return { price: 0, tvl: 0 };
}

async function getSlipstreamPrice(pair: Pair): Promise<{ price: number; tvl: number }> {
  for (const ts of [1, 10, 50, 100, 200, 500]) {
    const k = `s:${pair.tokenIn}-${pair.tokenOut}-${ts}`;
    if (cache.has(k)) {
      const p = cache.get(k)!;
      if (p !== ZERO) {
        return await readV3Pool(p, pair);
      }
      continue;
    }
    const tsHex = ts.toString(16).padStart(64, "0");
    const data =
      "0x28af8d0b" +
      pair.tokenIn.toLowerCase().slice(2).padStart(64, "0") +
      pair.tokenOut.toLowerCase().slice(2).padStart(64, "0") +
      tsHex;
    let found: string | null = null;
    for (const factory of SLIPSTREAM_FACTORIES) {
      const r = await ethCall(factory, data);
      if (!r) continue;
      const pool = "0x" + r.slice(-40);
      if (pool !== ZERO) { found = pool; break; }
    }
    if (!found) { cache.set(k, ZERO); continue; }
    cache.set(k, found);
    return await readV3Pool(found, pair);
  }
  return { price: 0, tvl: 0 };
}

async function readPool(pool: string, pair: Pair): Promise<{ price: number; tvl: number }> {
  const [t0, rr] = await Promise.all([
    ethCall(pool, "0x0dfe1681"),
    ethCall(pool, "0x0902f1ac"),
  ]);
  if (!t0 || !rr) return { price: 0, tvl: 0 };
  const t0a = "0x" + t0.slice(-40).toLowerCase();
  const h = rr.slice(2);
  const r0 = BigInt("0x" + h.slice(0, 64));
  const r1 = BigInt("0x" + h.slice(64, 128));
  const in0 = t0a === pair.tokenIn.toLowerCase();
  const ri = in0 ? r0 : r1;
  const ro = in0 ? r1 : r0;
  if (ri === 0n) return { price: 0, tvl: 0 };
  const price = (Number(ro) / 10 ** pair.outDec) / (Number(ri) / 10 ** pair.inDec);
  const baseReserve = in0 ? r1 : r0;
  const baseDec = in0 ? pair.outDec : pair.inDec;
  let tvl = 0;
  if (pair.tokenOut === T.WETH || pair.tokenIn === T.WETH) {
    tvl = 2 * (Number(baseReserve) / 10 ** baseDec) * 2650;
  } else {
    tvl = 2 * (Number(baseReserve) / 10 ** baseDec);
  }
  return { price, tvl };
}

async function readV3Pool(pool: string, pair: Pair): Promise<{ price: number; tvl: number }> {
  const slot0 = await ethCall(pool, "0x3850c7bd");
  if (!slot0) return { price: 0, tvl: 0 };
  const sqrtPriceX96 = BigInt("0x" + slot0.slice(2, 66));
  if (sqrtPriceX96 === 0n) return { price: 0, tvl: 0 };
  const num = sqrtPriceX96 * sqrtPriceX96;
  const den = 2n ** 192n;
  const raw = Number(num) / Number(den);
  const t0 = await ethCall(pool, "0x0dfe1681");
  if (!t0) return { price: 0, tvl: 0 };
  const t0a = "0x" + t0.slice(-40).toLowerCase();
  const in0 = t0a === pair.tokenIn.toLowerCase();
  const adj = 10 ** (pair.inDec - pair.outDec);
  const price = in0 ? raw * adj : (1 / raw) * adj;
  // Approximate TVL
  const liq = await ethCall(pool, "0x1a686502");
  let tvl = 0;
  if (liq) tvl = Number(BigInt("0x" + liq.slice(2))) / 1e18 * 2650;
  return { price, tvl };
}

export interface ArbOpportunity {
  pair: string;
  buyDex: string;
  sellDex: string;
  spreadPct: number;
  netSpreadPct: number;
  buyPrice: number;
  sellPrice: number;
  tvl: number;
  profitUsd: number;
}

export async function scanArbitrage(): Promise<ArbOpportunity[]> {
  const opportunities: ArbOpportunity[] = [];

  for (const pair of PAIRS) {
    try {
      const [aero, uni, slip] = await Promise.all([
        getAerodromePrice(pair),
        getUniswapV3Price(pair),
        getSlipstreamPrice(pair),
      ]);

      const prices = [
        { dex: "Aerodrome", price: aero.price, tvl: aero.tvl },
        { dex: "Uniswap", price: uni.price, tvl: uni.tvl },
        { dex: "Slipstream", price: slip.price, tvl: slip.tvl },
      ].filter(p => p.price > 0 && p.tvl > 0);

      if (prices.length < 2) continue;

      // Find max spread
      for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
          const spread = Math.abs(prices[i].price - prices[j].price) / Math.min(prices[i].price, prices[j].price) * 100;
          const netSpread = spread - 0.3; // subtract fees

          if (netSpread > 0.05) { // > 0.05% net profit
            const buyDex = prices[i].price < prices[j].price ? prices[i] : prices[j];
            const sellDex = prices[i].price < prices[j].price ? prices[j] : prices[i];
            const tvl = Math.min(buyDex.tvl, sellDex.tvl);

            if (tvl < 1000) continue; // skip low liquidity

            opportunities.push({
              pair: pair.name,
              buyDex: buyDex.dex,
              sellDex: sellDex.dex,
              spreadPct: spread,
              netSpreadPct: netSpread,
              buyPrice: buyDex.price,
              sellPrice: sellDex.price,
              tvl,
              profitUsd: 0, // calculated by caller
            });
          }
        }
      }
    } catch (e) {
      // silent skip
    }
  }

  return opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
}
