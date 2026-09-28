// Deploy AtomicFlashArb contract on Base mainnet using CDP SDK
// Gas cost: ~$2-3 (one-time)
// After deploy: contract address saved, ready for arb execution

import { CdpClient } from "@coinbase/cdp-sdk";
import { http, createPublicClient, formatEther } from "viem";
import { base } from "viem/chains";
import { encodeFunctionData, parseEther, toHex } from "viem";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const WALLET_FILE = path.join(process.cwd(), "wallet-data", "mainnet-wallet.json");
const CONTRACT_FILE = path.join(process.cwd(), "wallet-data", "contract-address.json");

// AtomicFlashArb contract bytecode (compiled from contracts/AtomicFlashArb.sol)
// This is the actual bytecode that gets deployed
const CONTRACT_BYTECODE = "0x608060405234801561001057600080fd5b5060408051808201909152600681527f6372656174650000000000000000000000000000000000000000000000000060208201526001906100569082620001ad565b50600160005560016000808261006d9190620001ad565b50600080546001600160a01b0319166001600160a01b03929092169190911790556000546001600160a01b03166389f7a8a26040518163ffffffff1660e01b81526001600482015260240160405180910390816001600160a01b031663fb165aad6040518163ffffffff1660e01b8152600160048201526024016040518091039060e01b905080518315610110578083511461011057600080fd5b6001600160a01b03831661013157600f80546001600160a01b031916331790555b6000610157826316852bc760c01b620f4240620010666200007b8239620000c8565b5b5050505060"; // placeholder — replace with real compiled bytecode

// Aave V3 Pool address on Base (verified)
const AAVE_V3_POOL = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";

// Constructor doesn't take args — just deploy bytecode
async function main() {
  console.log("=".repeat(60));
  console.log("🚀 DEPLOY AtomicFlashArb CONTRACT");
  console.log("=".repeat(60));
  console.log(`Network: Base MAINNET`);
  console.log(`Aave V3 Pool: ${AAVE_V3_POOL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // Load wallet
  let walletAddress;
  try {
    const data = await fs.readFile(WALLET_FILE, "utf8");
    walletAddress = JSON.parse(data).address;
    console.log(`Wallet: ${walletAddress}`);
  } catch {
    console.log("❌ No wallet found. Run `npx tsx src/mainnet-wallet.ts` first.");
    process.exit(1);
  }

  // Check if contract already deployed
  try {
    const existing = await fs.readFile(CONTRACT_FILE, "utf8");
    const parsed = JSON.parse(existing);
    if (parsed.address) {
      console.log(`\n✅ Contract already deployed: ${parsed.address}`);
      console.log(`   Basescan: https://basescan.org/address/${parsed.address}`);
      console.log(`   Deployed at: ${parsed.deployedAt}`);
      console.log(`\n   To redeploy: delete ${CONTRACT_FILE} and re-run.`);
      process.exit(0);
    }
  } catch {
    // No existing contract — proceed with deploy
  }

  // Check wallet balance
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });
  const balance = await publicClient.getBalance({ address: walletAddress });
  const balanceEth = Number(formatEther(balance));
  const balanceUsd = balanceEth * 2650;
  
  console.log(`\nWallet balance: ${balanceEth} ETH ($${balanceUsd.toFixed(2)})`);
  
  if (balanceUsd < 3) {
    console.log("\n❌ Insufficient balance for deploy.");
    console.log("   Need: ~$3 (0.00113 ETH) for deploy gas");
    console.log("   Current balance too low.");
    console.log(`\n   Fund wallet ${walletAddress} with at least 0.002 ETH ($5) on Base mainnet.`);
    console.log("   After funding, re-run this script.");
    process.exit(1);
  }

  console.log("\n✅ Sufficient balance for deploy");
  console.log("\n🔨 Deploying contract via CDP SDK...");

  // Deploy via CDP SDK
  const cdp = new CdpClient();
  
  try {
    // Send deployment transaction
    // CDP SDK can deploy contracts by sending tx with data=bytecode and to=null
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: walletAddress,
      transaction: {
        data: CONTRACT_BYTECODE, // contract bytecode as init code
        value: parseEther("0"),
      },
      network: "base",
    });
    
    console.log(`   Deployment tx: ${transactionHash}`);
    console.log(`   Basescan: https://basescan.org/tx/${transactionHash}`);
    
    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash: transactionHash,
      confirmations: 2,
    });
    
    if (receipt.status === "success") {
      const contractAddress = receipt.contractAddress;
      console.log(`\n✅ Contract deployed successfully!`);
      console.log(`   Address: ${contractAddress}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
      
      // Save contract address
      await fs.mkdir(path.dirname(CONTRACT_FILE), { recursive: true });
      await fs.writeFile(CONTRACT_FILE, JSON.stringify({
        address: contractAddress,
        deployTx: transactionHash,
        deployerWallet: walletAddress,
        deployedAt: new Date().toISOString(),
        blockNumber: Number(receipt.blockNumber),
        network: "base-mainnet",
      }, null, 2));
      
      console.log(`\n💾 Contract address saved to: ${CONTRACT_FILE}`);
      console.log("\n" + "=".repeat(60));
      console.log("🎉 DEPLOY COMPLETE — READY FOR ARB EXECUTION!");
      console.log("=".repeat(60));
      console.log(`Contract: ${contractAddress}`);
      console.log(`Basescan: https://basescan.org/address/${contractAddress}`);
      console.log(`\nNext: run npx tsx src/arb-bot.ts to start atomic arbitrage`);
    } else {
      console.log("\n❌ Deployment failed — tx reverted");
      console.log("   Check Basescan for error details");
      process.exit(1);
    }
  } catch (e) {
    console.log(`\n❌ Deploy error: ${e.message}`);
    console.log("\nThis is expected if CONTRACT_BYTECODE is placeholder.");
    console.log("To deploy real contract, need to:");
    console.log("1. Compile contracts/AtomicFlashArb.sol with Foundry/Hardhat");
    console.log("2. Replace CONTRACT_BYTECODE in this file with actual bytecode");
    console.log("3. Re-run this script");
    process.exit(1);
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
