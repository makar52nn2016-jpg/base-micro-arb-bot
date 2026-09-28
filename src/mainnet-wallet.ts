// Create CDP wallet on Base MAINNET (real money, real network)
// This wallet will hold ETH for gas + be the arb contract owner

import { CdpClient } from "@coinbase/cdp-sdk";
import { http, createPublicClient, formatEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const WALLET_FILE = path.join(process.cwd(), "wallet-data", "mainnet-wallet.json");

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 CDP MAINNET WALLET SETUP");
  console.log("=".repeat(60));
  console.log(`Network: Base MAINNET (chainId: 8453)`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
  
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !process.env.CDP_WALLET_SECRET) {
    console.log("\n❌ Missing CDP credentials");
    process.exit(1);
  }
  console.log("\n✅ All CDP credentials present");

  const cdp = new CdpClient();
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC || "https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n"),
  });

  // Try to load existing mainnet wallet
  let walletAddress;
  try {
    const data = await fs.readFile(WALLET_FILE, "utf8");
    const parsed = JSON.parse(data);
    walletAddress = parsed.address;
    console.log(`\n📥 Loaded existing mainnet wallet: ${walletAddress}`);
  } catch {
    console.log("\n🔨 Creating new CDP wallet on Base MAINNET...");
    const account = await cdp.evm.createAccount();
    walletAddress = account.address;
    console.log(`   ✅ New wallet created: ${walletAddress}`);
    
    await fs.mkdir(path.dirname(WALLET_FILE), { recursive: true });
    await fs.writeFile(WALLET_FILE, JSON.stringify({
      address: walletAddress,
      network: "base-mainnet",
      created: new Date().toISOString(),
      note: "Created via CDP SDK — non-custodial wallet controlled by Coinbase infrastructure",
    }, null, 2));
  }

  // Check balance
  console.log("\n💰 Checking balance...");
  const balance = await publicClient.getBalance({ address: walletAddress });
  const balanceEth = formatEther(balance);
  const balanceUsd = (Number(balanceEth) * 2650).toFixed(2);
  console.log(`   Balance: ${balanceEth} ETH ($${balanceUsd})`);
  console.log(`   Basescan: https://basescan.org/address/${walletAddress}`);

  if (balance === 0n) {
    console.log("\n" + "=".repeat(60));
    console.log("⚠️  WALLET NEEDS FUNDING TO START");
    console.log("=".repeat(60));
    console.log(`
To start earning, send ETH to this wallet on Base mainnet:

  Wallet address: ${walletAddress}

  Options to fund:
  1. Direct transfer from Coinbase (free, instant)
  2. Bridge from Ethereum via https://bridge.base.org (~$2 gas, 5 min)
  3. Withdraw from exchange (BingX, Binance) to Base network
  4. Bridge from Optimism via https://across.to (~$0.20 gas, 1 min)

  Recommended: $5-15 ETH (0.002-0.005 ETH)
  - $3 for deploying arb contract (one-time gas)
  - $2 for atomic execution callbacks
  - $5-10 buffer for ongoing gas costs

  After funding, re-run: npx tsx src/mainnet-wallet.ts
  Then we'll deploy the arb contract.
`);
    console.log("=".repeat(60));
  } else if (balance < parseEtherSafe("0.001")) {
    console.log(`\n⚠️  Balance too low ($${balanceUsd}). Need ~$5 to start.`);
  } else {
    console.log(`\n✅ Wallet funded! Ready for contract deployment.`);
    console.log(`   Next: npx tsx src/deploy-contract.ts`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("WALLET DETAILS (save this):");
  console.log("=".repeat(60));
  console.log(`  Address: ${walletAddress}`);
  console.log(`  Network: Base mainnet`);
  console.log(`  Saved to: ${WALLET_FILE}`);
  console.log(`  View: https://basescan.org/address/${walletAddress}`);
  console.log("=".repeat(60));
}

function parseEtherSafe(eth) {
  // Convert decimal ETH to wei BigInt
  const [whole, frac = ""] = eth.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole) * BigInt(10) ** 18n + BigInt(fracPadded || "0");
}

main().catch(e => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
