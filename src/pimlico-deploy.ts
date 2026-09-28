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

// COMPILED bytecode from contracts/FlashLoanSimple.sol (github.com/0xkabbo/flash-loan-arbitrage-base)
// Compiled with solc 0.8.37, optimizer enabled (200 runs)
// Constructor: needs _addressProvider (Aave PoolAddressesProvider on Base)
const AAVE_POOL_ADDRESSES_PROVIDER_BASE = "0xe20fCBdbffc4dd138ce8b2e6fbb6cb49777ad64d";
const CONTRACT_BYTECODE = "0x60c060405234801561000f575f5ffd5b5060405161071638038061071683398101604081905261002e916100cd565b80806001600160a01b03166080816001600160a01b031681525050806001600160a01b031663026b1d5f6040518163ffffffff1660e01b8152600401602060405180830381865afa158015610085573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906100a991906100cd565b6001600160a01b031660a05250505f80546001600160a01b031916331790556100fa565b5f602082840312156100dd575f5ffd5b81516001600160a01b03811681146100f3575f5ffd5b9392505050565b60805160a0516105ee6101285f395f818161011301528181610195015261038101525f607301526105ee5ff3fe608060405260043610610057575f3560e01c80630542975c146100625780631b11d0ff146100b257806351cff8d9146100e15780637535d246146101025780638da5cb5b14610135578063d54ba95414610153575f5ffd5b3661005e57005b5f5ffd5b34801561006d575f5ffd5b506100957f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020015b60405180910390f5b3480156100bd575f5ffd5b506100d16100cc36600461040f565b610172565b60405190151581526020016100a9565b3480156100ec575f5ffd5b506101006100fb3660046104b0565b610221565b005b34801561010d575f5ffd5b506100957f000000000000000000000000000000000000000000000000000000000000000081565b348015610140575f5ffd5b505f54610095906001600160a01b031681565b34801561015e575f5ffd5b5061010061016d3660046104d0565b610354565b5f8061017e86886104f8565b60405163095ea7b360e01b81526001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081166004830152602482018390529192509089169063095ea7b3906044016020604051808303815f875af11580156101ee573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610212919061051d565b50600198975050505050505050565b5f546001600160a01b0316331461026b5760405162461bcd60e51b815260206004820152600a60248201526927b7363c9037bbb732b960b11b604482015260640160405180910390fd5b5f546040516370a0823160e01b815230600482015282916001600160a01b038084169263a9059cbb92919091169083906370a0823190602401602060405180830381865afa1580156102bf573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906102e3919061053c565b6040516001600160e01b031960e085901b1681526001600160a01b03909216600483015260248201526044016020604051808303815f875af115801561032b573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061034f919061051d565b505050565b604080516020810182525f80825291516310ac2ddf60e21b81523092859285929091906001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016906342b0b77c906103be9088908890889088908890600401610553565b5f604051808303815f87803b1580156103d5575f5ffd5b505af11580156103e7573d5f5f3e3d5ffd5b5050505050505050505050565b80356001600160a01b038116811461040a575f5ffd5b919050565b5f5f5f5f5f5f60a08789031215610424575f5ffd5b61042d876103f4565b95506020870135945060408701359350610449606088016103f4565b9250608087013567ffffffffffffffff811115610464575f5ffd5b8701601f81018913610474575f5ffd5b803567ffffffffffffffff81111561048a575f5ffd5b89602082840101111561049b575f5ffd5b60208201935080925050509295509295509295565b5f602082840312156104c0575f5ffd5b6104c9826103f4565b9392505050565b5f5f604083850312156104e1575f5ffd5b6104ea836103f4565b946020939093013593505050565b8082018082111561051757634e487b7160e01b5f52601160045260245ffd5b92915050565b5f6020828403121561052d575f5ffd5b815180151581146104c9575f5ffd5b5f6020828403121561054c575f5ffd5b5051919050565b60018060a01b038616815260018060a01b038516602082015283604082015260a060608201525f83518060a0840152806020860160c085015e5f60c0828501015260c0601f19601f83011684010191505061ffff83166080830152969550505050505056fea2646970667358221220f85ec98cf34d388bd0c53bd1599203c13ac5b99c40af722f3210a014ed9946e364736f6c63430008250033";

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

  // Encode constructor argument: constructor(address _addressProvider)
  // ABI encoding: address padded to 32 bytes (64 hex chars)
  const addressProviderArg = AAVE_POOL_ADDRESSES_PROVIDER_BASE.toLowerCase().slice(2).padStart(64, "0");
  const deployData = (CONTRACT_BYTECODE + addressProviderArg) as `0x${string}`;

  // Send deployment UserOperation
  console.log("\n📤 Sending deployment UserOperation...");
  console.log(`   bytecode: ${CONTRACT_BYTECODE.slice(0, 50)}...`);
  console.log(`   constructor arg: ${AAVE_POOL_ADDRESSES_PROVIDER_BASE}`);
  console.log(`   total data length: ${deployData.length} chars`);

  try {
    const tx = await smartAccountClient.sendUserOperation({
      calls: [
        {
          to: null,  // null = contract deployment
          data: deployData,  // bytecode + constructor arg
          value: 0n,
        },
      ],
    });

    console.log(`\n📤 UserOperation sent!`);
    console.log(`   Hash: ${tx}`);
    console.log(`   Waiting for receipt...`);

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
      hash: tx,
    });

    if (receipt.success) {
      // Find contract address from logs
      const contractAddress = receipt.receipt?.contractAddress || "unknown (check Basescan)";
      console.log(`\n✅ CONTRACT DEPLOYED!`);
      console.log(`   Contract address: ${contractAddress}`);
      console.log(`   Smart Account: ${safeAccount.address}`);
      console.log(`   Basescan: https://basescan.org/address/${contractAddress}`);

      await fs.mkdir(path.dirname(CONTRACT_FILE), { recursive: true });
      await fs.writeFile(CONTRACT_FILE, JSON.stringify({
        address: contractAddress,
        smartAccount: safeAccount.address,
        deployer: signer.address,
        deployTx: receipt.receipt?.transactionHash,
        network: "base-mainnet",
        deployedAt: new Date().toISOString(),
        blockNumber: Number(receipt.receipt?.blockNumber || 0),
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
