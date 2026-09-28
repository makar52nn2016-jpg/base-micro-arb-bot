import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { SafeSmartAccount } from "permissionless/accounts/safe";

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://base-mainnet.g.alchemy.com/v2/alch_BUo0TYqkD24rLEzrz4U3n"),
});

const signer = privateKeyToAccount("0xf28836ed0f3d4786c13469f13254bbe80999a27c41593480968835f3d064d3af");
console.log("Owner EOA:", signer.address);

try {
  const safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: {
      address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      version: "0.6",
    },
    version: "1.4.1",
  });
  const expected = "0x53dbe1b36ba3beac6cef6cd22ad50e362dbcb23a";
  const matches = safeAccount.address.toLowerCase() === expected;
  console.log("Safe Smart Account:", safeAccount.address);
  console.log("Expected:           0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A");
  console.log(matches ? "✅ MATCH! Private key is correct!" : "❌ Still mismatch");
} catch (e) {
  console.log("Error:", e.message?.slice(0, 100));
}
