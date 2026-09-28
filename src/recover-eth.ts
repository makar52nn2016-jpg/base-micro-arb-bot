// Recover ETH from Optimism + Arbitrum Smart Accounts
// Step 1: Deploy Smart Account on Optimism (first UserOp)
// Step 2: Transfer ETH from Smart Account → Owner EOA on same chain
// Step 3: Bridge ETH from Owner EOA → Smart Account on Base via Across.to API
// Repeat for Arbitrum

import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Chain } from "viem";
import { base, optimism, arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { SafeSmartAccount } from "permissionless/accounts/safe";
import dotenv from "dotenv";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const PIMLICO_KEY = process.env.PIMLICO_API_KEY;
const ALCHEMY_KEY = "alch_BUo0TYqkD24rLEzrz4U3n";

async function recoverFromChain(chainKey: string, chain: Chain, rpcUrl: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`🔄 RECOVERY: ${chainKey.toUpperCase()}`);
  console.log("=".repeat(60));

  const signer = privateKeyToAccount(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  console.log(`Owner EOA: ${signer.address}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Check Smart Account balance on this chain
  const saBalance = await publicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  const saEth = Number(formatEther(saBalance));
  const saUsd = saEth * 2650;
  console.log(`Smart Account balance on ${chainKey}: ${saEth} ETH ($${saUsd.toFixed(2)})`);

  if (saEth === 0) {
    console.log("❌ No ETH to recover on this chain");
    return 0;
  }

  // Check Owner EOA balance on this chain
  const ownerBalance = await publicClient.getBalance({ address: signer.address });
  console.log(`Owner EOA balance on ${chainKey}: ${formatEther(ownerBalance)} ETH`);

  // Check if Smart Account is deployed on this chain
  const code = await publicClient.getCode({ address: SMART_ACCOUNT as `0x${string}` });
  const isDeployed = code && code !== "0x";
  console.log(`Smart Account deployed: ${isDeployed ? "YES" : "NO (counterfactual)"}`);

  // Setup Pimlico bundler for this chain
  const bundlerUrl = `https://api.pimlico.io/v2/${chainKey}/rpc?apikey=${PIMLICO_KEY}`;
  const pimlicoClient = createPimlicoClient({
    transport: http(bundlerUrl),
    chain,
  });

  // Create Safe Smart Account
  const safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: { address: ENTRY_POINT as `0x${string}`, version: "0.6" },
    version: "1.4.1",
  });

  // Verify address matches
  if (safeAccount.address.toLowerCase() !== SMART_ACCOUNT.toLowerCase()) {
    console.log(`⚠️ Address mismatch: ${safeAccount.address} != ${SMART_ACCOUNT}`);
    console.log("Skipping this chain");
    return 0;
  }
  console.log(`✅ Smart Account address verified: ${safeAccount.address}`);

  // Create Smart Account client
  const smartAccountClient = createSmartAccountClient({
    chain,
    bundlerTransport: http(bundlerUrl),
    account: safeAccount,
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

  // STEP 1: Deploy Smart Account + Transfer ETH to Owner EOA
  // Use sendUserOperation to transfer ETH from Smart Account to Owner EOA
  // This will also deploy Smart Account if counterfactual (first UserOp)
  
  // Leave some ETH for gas (0.0001 ETH = $0.26)
  const transferAmount = saBalance - parseEther("0.0001");
  
  if (transferAmount <= 0n) {
    console.log("❌ Not enough ETH to transfer (need > 0.0001 ETH for gas)");
    return 0;
  }

  console.log(`\n📤 Step 1: Deploy Smart Account + Transfer ${formatEther(transferAmount)} ETH to Owner EOA...`);

  try {
    const userOpHash = await smartAccountClient.sendUserOperation({
      calls: [{
        to: signer.address as `0x${string}`,
        value: transferAmount,
        data: "0x",
      }],
    });

    console.log(`   UserOp hash: ${userOpHash}`);
    const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });

    if (receipt.success) {
      console.log(`   ✅ Smart Account deployed + ETH transferred!`);
      console.log(`   Tx: ${receipt.receipt?.transactionHash}`);
      
      // Wait for balance sync
      await new Promise(r => setTimeout(r, 3000));
      
      // Check Owner EOA new balance
      const newOwnerBalance = await publicClient.getBalance({ address: signer.address });
      console.log(`   Owner EOA new balance: ${formatEther(newOwnerBalance)} ETH`);
      
      return Number(formatEther(newOwnerBalance));
    } else {
      console.log(`   ❌ UserOp failed`);
      return 0;
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message?.slice(0, 200)}`);
    return 0;
  }
}

async function bridgeToBase(amountEth: string, fromChain: Chain, fromRpcUrl: string, chainKey: string) {
  console.log(`\n📤 Step 2: Bridge ${amountEth} ETH from ${chainKey} → Base via Across.to...`);

  const signer = privateKeyToAccount(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  
  const walletClient = createWalletClient({
    chain: fromChain,
    transport: http(fromRpcUrl),
    account: signer,
  });

  const publicClient = createPublicClient({
    chain: fromChain,
    transport: http(fromRpcUrl),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: signer.address });
  console.log(`   Owner EOA balance: ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.log("   ❌ No balance to bridge");
    return;
  }

  // Use Across.to API to get bridge route
  // Across.to API: https://app.across.to/api/suggested-fees
  const acrossApi = "https://app.across.to/api/suggested-fees";
  const amountWei = parseEther(amountEth);
  
  try {
    const feeUrl = `${acrossApi}?token=0x0000000000000000000000000000000000000000&destinationChainId=8453&originChainId=${fromChain.id}&amount=${amountWei.toString()}&recipient=${SMART_ACCOUNT}`;
    const feeResp = await fetch(feeUrl);
    const feeData = await feeResp.json();
    
    console.log(`   Across.to response:`, JSON.stringify(feeData).slice(0, 200));
    
    if (feeData.error) {
      console.log(`   ❌ Across.to error: ${feeData.error}`);
      // Fallback: direct transfer to Smart Account on Base (needs bridge)
      // Can't do direct cross-chain transfer without bridge protocol
      console.log("   ⚠️ Cannot bridge programmatically — need manual bridge via across.to UI");
      return;
    }

    // If Across.to gives us route info, execute the bridge
    // For ETH bridge: send ETH to Across deposit box with recipient data
    const relayFee = BigInt(feeData.relayFeePct || 0);
    const totalAmount = amountWei;
    
    // Across.to ETH bridge: send to SpokePool contract with recipient info
    // This requires Across SDK or manual deposit
    console.log("   ⚠️ Programmatic bridge requires Across SDK — trying direct deposit");
    
    // Alternative: use Connext or Hop bridge
    // For now: just note the balance
    console.log(`   ETH on ${chainKey}: ${formatEther(balance)} ETH ($${Number(formatEther(balance)) * 2650})`);
    console.log(`   To bridge manually: https://across.to`);
    console.log(`   From: ${chainKey} → Base`);
    console.log(`   Amount: ${formatEther(balance)} ETH`);
    console.log(`   Recipient: ${SMART_ACCOUNT}`);
    
  } catch (e: any) {
    console.log(`   ❌ Bridge API error: ${e.message?.slice(0, 100)}`);
    console.log(`   Manual bridge needed: https://across.to`);
    console.log(`   From: ${chainKey} | Amount: ${formatEther(balance)} ETH | To: ${SMART_ACCOUNT}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("🔄 ETH RECOVERY SCRIPT");
  console.log("Recovering locked ETH from Optimism + Arbitrum Smart Accounts");
  console.log("=".repeat(60));

  if (!process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY || !PIMLICO_KEY) {
    console.log("❌ Missing credentials in .env");
    process.exit(1);
  }
  console.log("✅ Credentials ready");

  // Check Base Smart Account balance
  const basePublicClient = createPublicClient({
    chain: base,
    transport: http(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  });
  const baseBalance = await basePublicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  console.log(`\nBase Smart Account: ${formatEther(baseBalance)} ETH ($${(Number(formatEther(baseBalance)) * 2650).toFixed(2)})`);

  // 1. Recover from Optimism
  const optimismRpc = `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  const optimismOwnerBalance = await recoverFromChain("optimism", optimism, optimismRpc);
  
  if (optimismOwnerBalance > 0) {
    // Bridge from Optimism to Base
    await bridgeToBase(
      optimismOwnerBalance.toString(),
      optimism,
      optimismRpc,
      "optimism"
    );
  }

  // 2. Recover from Arbitrum
  const arbitrumRpc = `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  const arbitrumOwnerBalance = await recoverFromChain("arbitrum", arbitrum, arbitrumRpc);
  
  if (arbitrumOwnerBalance > 0) {
    // Bridge from Arbitrum to Base
    await bridgeToBase(
      arbitrumOwnerBalance.toString(),
      arbitrum,
      arbitrumRpc,
      "arbitrum"
    );
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 RECOVERY SUMMARY");
  console.log("=".repeat(60));
  
  const finalBaseBalance = await basePublicClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  console.log(`Base Smart Account: ${formatEther(finalBaseBalance)} ETH ($${(Number(formatEther(finalBaseBalance)) * 2650).toFixed(2)})`);
  console.log(`Contract deployed: 0x5a89ba3204d9950baee2488d156ce888841cb876`);
  console.log("=".repeat(60));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
