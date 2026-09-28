// Pimlico Smart Account integration
// Uses existing Smart Account 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A
// Account abstraction with optional Pimlico paymaster (free gas!)

import { createPublicClient, http, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";

// Pimlico API (need API key — get free at https://dashboard.pimlico.io)
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || "";

// EntryPoint v0.6 on Base (verified)
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.ALCHEMY_BASE_RPC || "https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n"),
});

export async function getSmartAccountBalance() {
  try {
    const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
    const eth = Number(formatEther(balance));
    const usd = eth * 2650;
    return { eth, usd, balance };
  } catch (e: any) {
    console.error(`Failed to get balance: ${e.message}`);
    return { eth: 0, usd: 0, balance: 0n };
  }
}

export async function checkSmartAccountStatus() {
  console.log("=".repeat(60));
  console.log("🔑 Smart Account Status");
  console.log("=".repeat(60));
  console.log(`Address: ${SMART_ACCOUNT}`);
  console.log(`Network: Base mainnet (chainId: 8453)`);
  console.log(`EntryPoint: ${ENTRY_POINT}`);
  
  const { eth, usd } = await getSmartAccountBalance();
  console.log(`Balance: ${eth} ETH ($${usd.toFixed(4)})`);
  
  if (usd < 3) {
    console.log("\n❌ Insufficient balance for deploy (need ~$3)");
    console.log("   Bridge ETH from Optimism/Arbitrum via https://across.to");
    console.log(`   Recipient: ${SMART_ACCOUNT}`);
    return false;
  }
  
  console.log("\n✅ Sufficient balance for deploy + execution");
  console.log("\nReady for:");
  console.log("  1. Deploy AtomicFlashArb contract (~$3 gas)");
  console.log("  2. Run arb bot (uses remaining balance for atomic execution callbacks)");
  return true;
}

export { SMART_ACCOUNT, ENTRY_POINT, publicClient };

// If run directly, just check status
if (import.meta.url === `file://${process.argv[1]}`) {
  checkSmartAccountStatus().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
