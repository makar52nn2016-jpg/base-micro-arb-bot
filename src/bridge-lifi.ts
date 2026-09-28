// Bridge ETH from Optimism/Arbitrum → Base using Li.fi API
// Li.fi is free, no API key needed, returns full calldata

import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { optimism, arbitrum, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ALCHEMY_KEY = "alch_BUo0TYqkD24rLEzrz4U3n";

async function bridgeViaLiFi(chainKey: string, chain: any, chainId: number, rpcUrl: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🌉 BRIDGE: ${chainKey.toUpperCase()} → Base (Li.fi)`);
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
  const bridgeAmount = balance - parseEther("0.00002");
  if (bridgeAmount <= 0n) {
    console.log("❌ Not enough after gas reserve");
    return;
  }

  console.log(`Bridge amount: ${formatEther(bridgeAmount)} ETH`);
  console.log(`Recipient: ${SMART_ACCOUNT}`);

  // Step 1: Get quote from Li.fi
  console.log("\n📡 Getting Li.fi quote...");
  const quoteUrl = `https://li.quest/v1/quote?` +
    `fromChain=${chainId}` +
    `&toChain=8453` +
    `&fromToken=0x0000000000000000000000000000000000000000` +
    `&toToken=0x0000000000000000000000000000000000000000` +
    `&fromAmount=${bridgeAmount.toString()}` +
    `&fromAddress=${signer.address}` +
    `&toAddress=${SMART_ACCOUNT}`;

  const quoteResp = await fetch(quoteUrl);
  const quote = await quoteResp.json();

  if (!quote || (!quote.route && !quote.transactionRequest)) {
    console.log(`❌ No quote found`);
    console.log("Response:", JSON.stringify(quote).slice(0, 300));
    console.log(`\n📋 Manual bridge: https://li.fi`);
    console.log(`From: ${chainKey} | Amount: ${formatEther(bridgeAmount)} ETH | To: ${SMART_ACCOUNT}`);
    return;
  }

  const route = quote.route || quote;
  const tx = route.transactionRequest || quote.transactionRequest || route;
  
  console.log(`✅ Route found!`);
  console.log(`   Tool: ${route.tool || quote.tool || "?"}`);
  console.log(`   Bridge: ${route.bridge || "?"}`);
  console.log(`   To: ${tx.to}`);
  console.log(`   Value: ${tx.value}`);
  console.log(`   Data length: ${tx.data ? tx.data.length : 0} chars`);

  // Step 2: Send bridge transaction
  console.log("\n📤 Sending bridge tx...");
  try {
    const txHash = await walletClient.sendTransaction({
      account: signer,
      to: tx.to as `0x${string}`,
      value: BigInt(tx.value),
      data: tx.data as `0x${string}`,
      chain,
      gas: 500000n,
    });

    console.log(`✅ Bridge tx sent! Hash: ${txHash}`);
    console.log(`Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Status: ${receipt.status === "success" ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    if (receipt.status === "success") {
      console.log(`\n⏳ Bridge will arrive on Base in 1-5 minutes`);
      console.log(`Check: https://basescan.org/address/${SMART_ACCOUNT}`);
    }
  } catch (e: any) {
    console.log(`❌ Bridge tx failed: ${e.message?.slice(0, 200)}`);
    console.log(`\n📋 Manual bridge: https://li.fi`);
    console.log(`From: ${chainKey} | Amount: ${formatEther(bridgeAmount)} ETH | To: ${SMART_ACCOUNT}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("🌉 ETH RECOVERY: Li.fi bridge Optimism + Arbitrum → Base");
  console.log("=".repeat(60));

  // Bridge from Optimism
  await bridgeViaLiFi("optimism", optimism, 10, `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);

  // Bridge from Arbitrum
  await bridgeViaLiFi("arbitrum", arbitrum, 42161, `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);

  // Wait 60 seconds for bridge to settle
  console.log("\n⏳ Waiting 60 seconds for bridges to settle...");
  await new Promise(r => setTimeout(r, 60000));

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
