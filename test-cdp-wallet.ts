// Test CDP SDK — create wallet, fund from faucet (Base Sepolia testnet), send tx
import { CdpClient } from "@coinbase/cdp-sdk";
import { http, createPublicClient, formatEther, parseEther } from "viem";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const WALLET_FILE = path.join(process.cwd(), "wallet-data", "test-wallet.json");

async function main() {
  console.log("=".repeat(60));
  console.log("🧪 CDP SDK Test — create wallet, fund, send tx");
  console.log("=".repeat(60));
  
  // Check credentials
  const hasCreds = process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET;
  if (!hasCreds) {
    console.log("\n❌ Missing CDP credentials in .env:");
    console.log(`   CDP_API_KEY_ID: ${process.env.CDP_API_KEY_ID ? "✓ set" : "❌ missing"}`);
    console.log(`   CDP_API_KEY_SECRET: ${process.env.CDP_API_KEY_SECRET ? "✓ set" : "❌ missing"}`);
    console.log(`   CDP_WALLET_SECRET: ${process.env.CDP_WALLET_SECRET ? "✓ set" : "❌ missing (need to generate at portal.cdp.coinbase.com/wallets/non-custodial/security)"}`);
    return;
  }
  
  console.log("\n✅ All CDP credentials set in .env");
  
  try {
    // Initialize CDP client
    console.log("\n1. Initializing CDP client...");
    const cdp = new CdpClient();
    console.log("   ✓ CDP client created");
    
    // Try to load existing wallet
    let walletAddress;
    try {
      const data = await fs.readFile(WALLET_FILE, "utf8");
      const parsed = JSON.parse(data);
      walletAddress = parsed.address;
      console.log(`\n2. Loaded existing wallet: ${walletAddress}`);
    } catch {
      // Create new wallet
      console.log("\n2. Creating new CDP wallet on Base Sepolia (testnet)...");
      const account = await cdp.evm.createAccount();
      walletAddress = account.address;
      console.log(`   ✓ New wallet created: ${walletAddress}`);
      
      // Save wallet
      await fs.mkdir(path.dirname(WALLET_FILE), { recursive: true });
      await fs.writeFile(WALLET_FILE, JSON.stringify({
        address: walletAddress,
        created: new Date().toISOString(),
        network: "base-sepolia",
      }, null, 2));
    }
    
    // Create public client
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });
    
    // Check balance
    console.log("\n3. Checking balance on Base Sepolia...");
    const balance = await publicClient.getBalance({ address: walletAddress });
    const balanceEth = formatEther(balance);
    console.log(`   Balance: ${balanceEth} ETH`);
    
    if (balance === 0n) {
      console.log("\n4. Funding from Base Sepolia faucet...");
      try {
        const { transactionHash } = await cdp.evm.requestFaucet({
          address: walletAddress,
          network: "base-sepolia",
          token: "eth",
        });
        console.log(`   Faucet tx: ${transactionHash}`);
        await publicClient.waitForTransactionReceipt({ hash: transactionHash });
        console.log("   ✓ Faucet funded");
        await new Promise(r => setTimeout(r, 3000));
        
        const newBalance = await publicClient.getBalance({ address: walletAddress });
        console.log(`   New balance: ${formatEther(newBalance)} ETH`);
      } catch (e) {
        console.log(`   ❌ Faucet failed: ${e.message?.slice(0, 100)}`);
      }
    }
    
    // Send test tx
    if (balance > 0n || true) {
      console.log("\n5. Sending test tx (0.000001 ETH to self)...");
      try {
        const { transactionHash } = await cdp.evm.sendTransaction({
          address: walletAddress,
          transaction: {
            to: walletAddress,
            value: parseEther("0.000001"),
          },
          network: "base-sepolia",
        });
        console.log(`   ✓ Tx sent: ${transactionHash}`);
        console.log(`   Basescan: https://sepolia.basescan.org/tx/${transactionHash}`);
        await publicClient.waitForTransactionReceipt({ hash: transactionHash });
        console.log("   ✓ Tx confirmed");
      } catch (e) {
        console.log(`   ❌ Tx failed: ${e.message?.slice(0, 100)}`);
      }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ CDP SDK TEST COMPLETE");
    console.log("=".repeat(60));
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Network: Base Sepolia (testnet)`);
    console.log(`View: https://sepolia.basescan.org/address/${walletAddress}`);
    console.log("\nNext steps:");
    console.log("1. Switch to Base mainnet (network: 'base')");
    console.log("2. Fund wallet with real ETH (~0.005 = $13)");
    console.log("3. Run arb bot to start earning");
    
  } catch (e) {
    console.error("FATAL:", e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
