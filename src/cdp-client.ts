import { CdpClient } from "@coinbase/cdp-sdk";
import { http, createPublicClient, parseEther, formatEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const WALLET_FILE = path.join(process.cwd(), "wallet-data", "wallet.json");

let cdp: any = null;
let publicClient: any = null;
let walletAddress: string | null = null;

export async function initCDP() {
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET || !process.env.CDP_WALLET_SECRET) {
    throw new Error("Missing CDP credentials in .env. See README.md for setup instructions.");
  }

  cdp = new CdpClient();
  publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC || "https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n"),
  });

  // Try to load existing wallet from file
  try {
    const data = await fs.readFile(WALLET_FILE, "utf8");
    const parsed = JSON.parse(data);
    walletAddress = parsed.address;
    console.log(`[CDP] Loaded existing wallet: ${walletAddress}`);
    return walletAddress;
  } catch {
    // No existing wallet — create new
    console.log("[CDP] No existing wallet found. Creating new wallet...");
    const account = await cdp.evm.createAccount();
    walletAddress = account.address;
    
    // Save wallet info
    await fs.mkdir(path.dirname(WALLET_FILE), { recursive: true });
    await fs.writeFile(WALLET_FILE, JSON.stringify({
      address: walletAddress,
      created: new Date().toISOString(),
    }, null, 2));
    
    console.log(`[CDP] New wallet created: ${walletAddress}`);
    console.log(`[CDP] Fund this wallet with ETH on Base mainnet to start trading.`);
    console.log(`[CDP] View on Basescan: https://basescan.org/address/${walletAddress}`);
    return walletAddress;
  }
}

export async function getBalance(): Promise<{ eth: bigint; usd: number }> {
  if (!walletAddress || !publicClient) return { eth: 0n, usd: 0 };
  try {
    const eth = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
    const usd = Number(formatEther(eth)) * 2650; // approx ETH price
    return { eth, usd };
  } catch (e: any) {
    console.error(`[CDP] Balance check failed: ${e.message}`);
    return { eth: 0n, usd: 0 };
  }
}

export async function executeSwap(toAddress: string, valueEth: string): Promise<string | null> {
  if (!cdp || !walletAddress) return null;
  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: walletAddress,
      transaction: {
        to: toAddress as `0x${string}`,
        value: parseEther(valueEth),
      },
      network: "base",
    });
    await publicClient.waitForTransactionReceipt({ hash: transactionHash as `0x${string}` });
    return transactionHash;
  } catch (e: any) {
    console.error(`[CDP] Swap failed: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

export function getWalletAddress(): string | null {
  return walletAddress;
}

export { publicClient };
