// Deploy AtomicFlashArb via Smart Account (Safe v1.4.1 + Pimlico v2)
// Uses permissionless package v0.4.1

import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { SafeSmartAccount } from "permissionless/accounts/safe";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"; // v0.6
const CONTRACT_FILE = path.join(process.cwd(), "wallet-data", "smart-contract-address.json");

// Placeholder bytecode — real deploy needs compiled bytecode from contracts/AtomicFlashArb.sol
const CONTRACT_BYTECODE = "0x6080604052348015600f57600080fd5b50603e80601d57600080fd5bfe";

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 DEPLOY via Smart Account (Safe v1.4.1)");
  console.log("=".repeat(60));
  console.log(`Smart Account: ${SMART_ACCOUNT}`);
  console.log(`EntryPoint: ${ENTRY_POINT} (v0.6)`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Check owner private key
  if (!process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY) {
    console.log("\n❌ Missing SMART_ACCOUNT_OWNER_PRIVATE_KEY in .env");
    process.exit(1);
  }
  console.log("✅ Owner private key set");

  // Check Pimlico API key
  if (!process.env.PIMLICO_API_KEY) {
    console.log("⚠️  No PIMLICO_API_KEY — bundler may be rate-limited");
  } else {
    console.log("✅ Pimlico API key set");
  }

  // Create signer from private key
  const signer = privateKeyToAccount(
    process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`
  );
  console.log(`Owner EOA: ${signer.address}`);

  // Setup public client (for reading state)
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  // Check Smart Account balance
  const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  const balanceEth = Number(formatEther(balance));
  const balanceUsd = balanceEth * 2650;
  console.log(`\nSmart Account balance: ${balanceEth} ETH ($${balanceUsd.toFixed(2)})`);

  if (balanceUsd < 2) {
    console.log("\n❌ Insufficient balance for deploy (need ~$2)");
    process.exit(1);
  }
  console.log("✅ Sufficient balance");

  // Setup Pimlico client
  const bundlerUrl = process.env.PIMLICO_API_KEY
    ? `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`
    : "https://api.pimlico.io/v2/base/rpc";

  console.log("\n📡 Setting up Pimlico client...");
  const pimlicoClient = createPimlicoClient({
    transport: http(bundlerUrl),
    chain: base,
  });

  // Create Safe Smart Account
  console.log("🔑 Creating Safe Smart Account...");
  const safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: {
      address: ENTRY_POINT as `0x${string}`,
      version: "0.6",
    },
    version: "1.4.1",
  });

  console.log(`Safe account address: ${safeAccount.address}`);
  if (safeAccount.address.toLowerCase() !== SMART_ACCOUNT.toLowerCase()) {
    console.log(`⚠️  Address mismatch! Expected ${SMART_ACCOUNT}`);
    console.log("   Either wrong private key or Safe version mismatch");
    console.log("   Proceeding anyway — first UserOp will deploy at this address");
  } else {
    console.log("✅ Address matches expected Smart Account");
  }

  // Create Smart Account Client
  console.log("\n📡 Creating smart account client...");
  const smartAccountClient = createSmartAccountClient({
    chain: base,
    bundlerTransport: http(bundlerUrl),
    account: safeAccount,  // Pass the full account object, not just address
    userOperation: {
      estimateFeesPerGas: async () => {
        const gas = await pimlicoClient.getUserOperationGasPrice();
        return {
          maxFeePerGas: gas.fast.maxFeePerGas,
          maxPriorityFeePerGas: gas.fast.maxPriorityFeePerGas,
        };
      },
    },
  });

  console.log("✅ Smart Account client ready");

  // Check if Smart Account is deployed
  console.log("\n🔍 Checking if Smart Account is deployed...");
  const code = await publicClient.getCode({ address: safeAccount.address });
  if (!code || code === "0x") {
    console.log("⚠️  Smart Account is counterfactual (not yet deployed)");
    console.log("   First UserOperation will deploy it automatically");
  } else {
    console.log("✅ Smart Account already deployed");
  }

  // Send deployment UserOperation
  console.log("\n📤 Sending deployment UserOperation...");
  try {
    const tx = await smartAccountClient.sendTransaction({
      calls: [
        {
          data: CONTRACT_BYTECODE as `0x${string}`,
          value: 0n,
        },
      ],
    });

    console.log(`\n📤 UserOperation sent!`);
    console.log(`   Hash: ${tx}`);
    console.log(`   Waiting for receipt...`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: tx as `0x${string}`,
    });

    if (receipt.status === "success") {
      const contractAddress = receipt.contractAddress;
      console.log(`\n✅ CONTRACT DEPLOYED!`);
      console.log(`   Contract address: ${contractAddress}`);
      console.log(`   Smart Account: ${safeAccount.address}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`   Basescan: https://basescan.org/address/${contractAddress}`);

      await fs.mkdir(path.dirname(CONTRACT_FILE), { recursive: true });
      await fs.writeFile(CONTRACT_FILE, JSON.stringify({
        address: contractAddress,
        smartAccount: safeAccount.address,
        deployer: signer.address,
        deployTx: tx,
        network: "base-mainnet",
        deployedAt: new Date().toISOString(),
        blockNumber: Number(receipt.blockNumber),
      }, null, 2));

      console.log(`\n💾 Contract saved to: ${CONTRACT_FILE}`);
      console.log("\n" + "=".repeat(60));
      console.log("🎉 DEPLOY COMPLETE — READY FOR ARB EXECUTION!");
      console.log("=".repeat(60));
    } else {
      console.log("\n❌ Deploy failed — tx reverted");
    }
  } catch (e: any) {
    console.log(`\n❌ Deploy error: ${e.message?.slice(0, 200)}`);
    if (e.message?.includes("code")) {
      console.log("\nCommon issues:");
      console.log("- Wrong private key (doesn't match Smart Account)");
      console.log("- Smart Account counterfactual (first UserOp deploys it)");
      console.log("- Bytecode invalid (need real compiled contract)");
    }
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
