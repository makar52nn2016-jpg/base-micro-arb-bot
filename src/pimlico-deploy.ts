// Deploy AtomicFlashArb contract via Smart Account using Pimlico
// Uses permissionless package + owner EOA private key to send UserOperation
// Smart Account 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A executes the deploy

import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient, pimlicoBundlerClient } from "permissionless";
import { toOwner } from "permissionless/accounts/safe";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"; // v0.6
const SAFE_4337_MODULE = "0x75cf9e0e1Ef2b00 dap4cE2A2CE15A0e0A3F4EBc7"; // Safe 4337 module on Base
const CONTRACT_FILE = path.join(process.cwd(), "wallet-data", "smart-contract-address.json");

// AtomicFlashArb contract bytecode — placeholder, replace with real compiled bytecode
const CONTRACT_BYTECODE = "0x608060405234801561001057600080fd5b5060405161063a38038061063a8339810160408190526100299161005e565b600080546001600160a01b0316906001600160a01b038316906103e8906100509061005e565b80604051826100509190610100565b60405191506001600160a01b03821661005e57600080fd5b50506101a4565b60006020828403121561007057600080fd5b81516001600160a01b038116811461008857600080fd5b9392505080516020601f8301818401378101905061009c565b5b60405190808252803561009c575080806100b2565b5080fd5b905061005e565b6020015b808211610105576000815560010161009d565b5b5050801561010357610104565b610103565b50505050505050565b6001600160a01b038116610119578083511461011957600080fd5b600080546001600160a01b031916331790555b5050505b505050610163565b6000610146826316852bc760c01b620f4240610666610007823961000c8565b5b50505050610163565b5b5050610163565b5b5050505050610639565b5050610163565b5b50505050610638565b50505050610638565b5b505050506001610638565b5b505050506000610638565b5b505050505061063856";

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 DEPLOY AtomicFlashArb via Smart Account (Pimlico)");
  console.log("=".repeat(60));
  console.log(`Smart Account: ${SMART_ACCOUNT}`);
  console.log(`EntryPoint: ${ENTRY_POINT}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Check if already deployed
  try {
    const data = await fs.readFile(CONTRACT_FILE, "utf8");
    const parsed = JSON.parse(data);
    if (parsed.address && parsed.address !== "PLACEHOLDER") {
      console.log(`\n✅ Contract already deployed: ${parsed.address}`);
      console.log(`   Basescan: https://basescan.org/address/${parsed.address}`);
      process.exit(0);
    }
  } catch {
    // Not deployed
  }

  // Check credentials
  if (!process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY) {
    console.log("\n❌ Missing SMART_ACCOUNT_OWNER_PRIVATE_KEY in .env");
    console.log("\nSetup instructions:");
    console.log("1. Get owner private key from MetaMask:");
    console.log("   - Open MetaMask > Account details > Show private key");
    console.log("   - This is the EOA that owns Smart Account 0x53dbe1b...");
    console.log("2. Get Pimlico API key (free): https://dashboard.pimlico.io");
    console.log("3. Create .env file with:");
    console.log("   SMART_ACCOUNT_OWNER_PRIVATE_KEY=0x...");
    console.log("   PIMLICO_API_KEY=your_pimlico_key");
    console.log("4. Re-run: npx tsx src/pimlico-deploy.ts");
    console.log("\n.env is in .gitignore — safe, won't be committed");
    process.exit(1);
  }
  console.log("✅ Owner private key set");

  if (!process.env.PIMLICO_API_KEY) {
    console.log("⚠️  No PIMLICO_API_KEY — bundler may be slow/rate-limited");
  }

  // Create owner account
  const ownerAccount = privateKeyToAccount(
    process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`
  );
  console.log(`Owner EOA: ${ownerAccount.address}`);

  // Setup clients
  const bundlerUrl = process.env.PIMLICO_API_KEY
    ? `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`
    : "https://api.pimlico.io/v2/base/rpc";

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  // Check Smart Account balance
  const balance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  const balanceEth = Number(formatEther(balance));
  const balanceUsd = balanceEth * 2650;
  console.log(`\nSmart Account balance: ${balanceEth} ETH ($${balanceUsd.toFixed(2)})`);

  if (balanceUsd < 3) {
    console.log("\n❌ Insufficient balance for deploy (~$3 gas needed)");
    console.log(`   Bridge ETH to ${SMART_ACCOUNT} via https://across.to`);
    process.exit(1);
  }
  console.log("✅ Sufficient balance");

  // Create Pimlico bundler client
  console.log("\n📡 Setting up Pimlico bundler client...");
  const bundlerClient = pimlicoBundlerClient({
    transport: http(bundlerUrl),
    chain: base,
  });

  // Create Smart Account client (Safe v1.4.1 + EntryPoint v0.6)
  console.log("🔑 Setting up Smart Account client...");
  const smartAccountClient = createSmartAccountClient({
    chain: base,
    bundlerTransport: http(bundlerUrl),
    owner: ownerAccount,
    entryPoint: ENTRY_POINT,
    account_address: SMART_ACCOUNT as `0x${string}`,
  });

  console.log("✅ Smart Account client ready");
  console.log("\n🔨 Deploying contract...");

  try {
    // Send deployment transaction via Smart Account
    // In viem, contract deployment = sendTransaction with data=bytecode, no `to`
    const deployTx = await smartAccountClient.sendTransaction({
      calls: [
        {
          data: CONTRACT_BYTECODE as `0x${string}`,
          value: 0n,
        },
      ],
    });

    console.log(`\n📤 Deploy UserOperation sent!`);
    console.log(`   UserOp hash: ${deployTx.id ?? deployTx}`);
    console.log(`   Waiting for confirmation...`);

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: deployTx.id as `0x${string}`,
    });

    if (receipt.status === "success") {
      const contractAddress = receipt.contractAddress;
      console.log(`\n✅ CONTRACT DEPLOYED SUCCESSFULLY!`);
      console.log(`   Address: ${contractAddress}`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`   Basescan: https://basescan.org/address/${contractAddress}`);

      // Save
      await fs.mkdir(path.dirname(CONTRACT_FILE), { recursive: true });
      await fs.writeFile(CONTRACT_FILE, JSON.stringify({
        address: contractAddress,
        smartAccount: SMART_ACCOUNT,
        deployer: ownerAccount.address,
        deployTx: deployTx.id,
        network: "base-mainnet",
        deployedAt: new Date().toISOString(),
        blockNumber: Number(receipt.blockNumber),
      }, null, 2));

      console.log(`\n💾 Contract address saved to: ${CONTRACT_FILE}`);
      console.log("\n" + "=".repeat(60));
      console.log("🎉 DEPLOY COMPLETE — READY FOR ARB EXECUTION!");
      console.log("=".repeat(60));
      console.log(`Contract: ${contractAddress}`);
      console.log(`Smart Account: ${SMART_ACCOUNT}`);
      console.log(`\nNext: npx tsx src/arb-bot-pimlico.ts`);
    } else {
      console.log("\n❌ Deploy failed — tx reverted");
      process.exit(1);
    }
  } catch (e: any) {
    console.log(`\n❌ Deploy error: ${e.message?.slice(0, 200)}`);
    if (e.message?.includes("code")) {
      console.log(`\nCommon issues:`);
      console.log("- Wrong private key (doesn't match Smart Account owner)");
      console.log("- Smart Account not yet deployed as proxy (counterfactual)");
      console.log("- Pimlico API key invalid");
      console.log("- Bytecode invalid (need real compiled contract)");
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
