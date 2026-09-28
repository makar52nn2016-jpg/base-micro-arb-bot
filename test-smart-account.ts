// Test simple transaction via Smart Account — not deploy, just ETH transfer to self
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { SafeSmartAccount } from "permissionless/accounts/safe";
import { parseEther } from "viem";
import dotenv from "dotenv";

dotenv.config();

const SMART_ACCOUNT = "0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A";
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

async function main() {
  console.log("=".repeat(60));
  console.log("🧪 Test Smart Account: simple ETH transfer to self");
  console.log("=".repeat(60));

  const signer = privateKeyToAccount(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  console.log("Owner:", signer.address);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  const bundlerUrl = `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const pimlicoClient = createPimlicoClient({
    transport: http(bundlerUrl),
    chain: base,
  });

  const safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: { address: ENTRY_POINT as `0x${string}`, version: "0.6" },
    version: "1.4.1",
  });
  console.log("Smart Account:", safeAccount.address);

  // Check deployed status
  const code = await publicClient.getCode({ address: safeAccount.address });
  console.log("Smart Account deployed:", !code || code === "0x" ? "NO (counterfactual)" : "YES");

  const smartAccountClient = createSmartAccountClient({
    chain: base,
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

  // Test 1: send 0 ETH to self (simplest UserOp)
  console.log("\n📤 Sending simple UserOp (0 ETH to self)...");
  try {
    const userOpHash = await smartAccountClient.sendUserOperation({
      calls: [
        {
          to: safeAccount.address as `0x${string}`,
          value: parseEther("0"),
          data: "0x",
        },
      ],
    });
    console.log("✅ UserOp submitted!");
    console.log("   Hash:", userOpHash);

    // Wait for confirmation
    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    console.log("   Receipt:", receipt.success ? "✅ SUCCESS" : "❌ FAILED");
    console.log("   Tx hash:", receipt.receipt.transactionHash);
  } catch (e) {
    console.log("❌ UserOp failed:", e.message?.slice(0, 200));
    if (e.details) console.log("   Details:", e.details.slice(0, 200));
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
