// Simple ETH bridge from Optimism/Arbitrum → Base via Across.to REST API
// No SDK needed — direct API call + viem walletClient

import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { optimism, arbitrum, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ALCHEMY_KEY = "alch_BUo0TYqkD24rLEzrz4U3n";
const ETH_ZERO = "0x0000000000000000000000000000000000000000";

async function bridgeEth(chainKey: string, chain: any, chainId: number, rpcUrl: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🌉 BRIDGE: ${chainKey.toUpperCase()} → Base (direct API)`);
  console.log("=".repeat(60));

  const signer = privateKeyToAccount(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account: signer });

  const balance = await publicClient.getBalance({ address: signer.address });
  const balEth = Number(formatEther(balance));
  console.log(`Balance on ${chainKey}: ${balEth} ETH ($${(balEth * 2650).toFixed(2)})`);

  if (balEth < 0.00005) {
    console.log("❌ Not enough ETH to bridge");
    return;
  }

  // Leave tiny amount for gas
  const bridgeAmount = balance - parseEther("0.00003");
  if (bridgeAmount <= 0n) {
    console.log("❌ Not enough after gas reserve");
    return;
  }

  console.log(`Bridge amount: ${formatEther(bridgeAmount)} ETH`);
  console.log(`Recipient: ${SMART_ACCOUNT}`);

  // Step 1: Get route from Across.to API
  console.log("\n📡 Getting route from Across.to API...");
  const routeUrl = `https://app.across.to/api/suggested-routes?` +
    `originChainId=${chainId}` +
    `&destinationChainId=8453` +
    `&inputAmount=${bridgeAmount.toString()}` +
    `&inputToken=${ETH_ZERO}` +
    `&outputToken=${ETH_ZERO}` +
    `&recipient=${SMART_ACCOUNT}` +
    `&depositor=${signer.address}`;

  const routeResp = await fetch(routeUrl);
  const route = await routeResp.json();
  
  if (route.error || !route.routes || route.routes.length === 0) {
    console.log(`❌ No route found: ${route.error || "empty routes"}`);
    console.log("Full response:", JSON.stringify(route).slice(0, 500));
    
    // Fallback: manual instructions
    console.log(`\n📋 Manual bridge:`);
    console.log(`1. https://across.to`);
    console.log(`2. From: ${chainKey} | To: Base`);
    console.log(`3. Amount: ${formatEther(bridgeAmount)} ETH`);
    console.log(`4. Recipient: ${SMART_ACCOUNT}`);
    return;
  }

  console.log(`✅ Route found!`);
  const bestRoute = route.routes[0];
  console.log(`   SpokePool: ${bestRoute.spokePool || bestRoute.deposit.spokePool || "unknown"}`);
  console.log(`   Output amount: ${bestRoute.outputAmount || "unknown"}`);
  console.log(`   Estimated fill time: ${bestRoute.estimatedFillTimeSec || "?"}s`);

  // Step 2: Get deposit calldata
  console.log("\n📡 Getting deposit calldata...");
  const calldataUrl = `https://app.across.to/api/suggested-deposit?` +
    `originChainId=${chainId}` +
    `&destinationChainId=8453` +
    `&inputAmount=${bridgeAmount.toString()}` +
    `&inputToken=${ETH_ZERO}` +
    `&outputToken=${ETH_ZERO}` +
    `&recipient=${SMART_ACCOUNT}` +
    `&depositor=${signer.address}`;

  let depositData;
  try {
    const cdResp = await fetch(calldataUrl);
    depositData = await cdResp.json();
    console.log("Deposit data:", JSON.stringify(depositData).slice(0, 300));
  } catch (e: any) {
    console.log("Deposit API error:", e.message?.slice(0, 100));
  }

  // Step 3: Send deposit transaction
  // Across V2 deposit: call deposit() on SpokePool
  // SpokePool.deposit(recipient, originToken, amount, destinationChainId, relayerFeePct, quoteTimestamp, ...)
  
  // Use hardcoded SpokePool addresses (verified on Across docs)
  const spokePools: Record<string, string> = {
    optimism: "0x6f26Bf09B1C79eD494A27A1F2815F82912B97E54",
    arbitrum: "0x19Df3B4Bb65378a9Bf89dFd8D792D9dc60E9E554",
  };

  const spokePool = spokePools[chainKey];
  if (!spokePool) {
    console.log(`❌ No SpokePool address for ${chainKey}`);
    return;
  }

  console.log(`\n📡 Sending deposit to SpokePool ${spokePool}...`);

  // encode depositV3(recipient, inputToken, outputToken, inputAmount, outputAmount, 
  //                  destinationChainId, exclusiveRelayer, quoteTimestamp, fillDeadline, 
  //                  exclusivityDeadline, message)
  // Or simpler: deposit(recipient, originToken, amount, destinationChainId, relayerFeePct, quoteTimestamp)
  // deposit() selector = 0x4c84f9c0
  
  // Build calldata manually based on Across V2 deposit function
  // We need: relayerFeePct (from route) and quoteTimestamp (from route)
  const relayerFeePct = bestRoute.relayerFeePct || "0";
  const quoteTimestamp = bestRoute.quoteTimestamp || Math.floor(Date.now() / 1000);

  // Encode deposit(recipient, originToken, amount, destinationChainId, relayerFeePct, quoteTimestamp)
  // = 0x4c84f9c0 + recipient(32) + originToken(32) + amount(32) + destinationChainId(32) + relayerFeePct(32) + quoteTimestamp(32)
  const recipientPadded = SMART_ACCOUNT.toLowerCase().slice(2).padStart(64, "0");
  const originTokenPadded = ETH_ZERO.slice(2).padStart(64, "0");
  const amountHex = bridgeAmount.toString(16).padStart(64, "0");
  const destChainPadded = (8453).toString(16).padStart(64, "0");
  const feePctHex = BigInt(relayerFeePct).toString(16).padStart(64, "0");
  const timestampHex = BigInt(quoteTimestamp).toString(16).padStart(64, "0");
  
  const calldata = "0x4c84f9c0" + recipientPadded + originTokenPadded + amountHex + destChainPadded + feePctHex + timestampHex;

  console.log(`Calldata length: ${calldata.length} chars`);

  try {
    const txHash = await walletClient.sendTransaction({
      account: signer,
      to: spokePool as `0x${string}`,
      value: bridgeAmount,
      data: calldata as `0x${string}`,
      chain,
      gas: 200000n,
    });

    console.log(`\n✅ Bridge tx sent! Hash: ${txHash}`);
    console.log(`Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Status: ${receipt.status === "success" ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    if (receipt.status === "success") {
      console.log(`\n⏳ Bridge will fill on Base in 1-5 minutes`);
      console.log(`Check: https://basescan.org/address/${SMART_ACCOUNT}`);
    }
  } catch (e: any) {
    console.log(`\n❌ Bridge tx failed: ${e.message?.slice(0, 200)}`);
    console.log(`\n📋 Manual bridge needed:`);
    console.log(`1. https://across.to`);
    console.log(`2. From: ${chainKey} → Base`);
    console.log(`3. Amount: ${formatEther(bridgeAmount)} ETH`);
    console.log(`4. Recipient: ${SMART_ACCOUNT}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("🌉 ETH RECOVERY: Bridge Optimism + Arbitrum → Base");
  console.log("=".repeat(60));

  // Bridge from Optimism
  await bridgeEth("optimism", optimism, 10, `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);

  // Bridge from Arbitrum  
  await bridgeEth("arbitrum", arbitrum, 42161, `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);

  // Check Base balance
  console.log("\n" + "=".repeat(60));
  const baseClient = createPublicClient({
    chain: base,
    transport: http(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`),
  });
  const baseBalance = await baseClient.getBalance({ address: SMART_ACCOUNT as `0x${string}` });
  console.log(`Base Smart Account: ${formatEther(baseBalance)} ETH ($${(Number(formatEther(baseBalance)) * 2650).toFixed(2)})`);
  console.log("=".repeat(60));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
