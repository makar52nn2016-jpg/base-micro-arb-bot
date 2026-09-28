// Deploy contract: 2-step approach
// Step 1: Send ETH from Smart Account to Owner EOA (via Pimlico UserOp)
// Step 2: Deploy contract from Owner EOA (standard viem sendTransaction)

import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
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
const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
// Simplified contract — no getPool() call in constructor
const AAVE_POOL_ADDRESS = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5"; // Verified Pool on Base
const BYTECODE = "0x60a060405234801561000f575f5ffd5b506040516105e83803806105e883398101604081905261002e91610050565b6001600160a01b03166080525f80546001600160a01b0319163317905561007d565b5f60208284031215610060575f5ffd5b81516001600160a01b0381168114610076575f5ffd5b9392505050565b6080516105466100a25f395f818160bd01528181610157015261035601526105465ff3fe60806040526004361061004c575f3560e01c80631b11d0ff1461005757806351cff8d91461008b5780637535d246146100ac5780638da5cb5b146100f7578063d54ba95414610115575f5ffd5b3661005357005b5f5ffd5b348015610062575f5ffd5b506100766100713660046103cc565b610134565b60405190151581526020015b60405180910390f35b348015610096575f5ffd5b506100aa6100a536600461046d565b6101e3565b005b3480156100b7575f5ffd5b506100df7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610082565b348015610102575f5ffd5b505f546100df906001600160a01b031681565b348015610120575f5ffd5b506100aa61012f36600461048d565b610316565b5f8061014086886104b5565b60405163095ea7b360e01b81526001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081166004830152602482018390529192509089169063095ea7b3906044016020604051808303815f875af11580156101b0573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906101d491906104da565b50600198975050505050505050565b5f546001600160a01b0316331461022d5760405162461bcd60e51b815260206004820152600a60248201526927b7363c9037bbb732b960b11b604482015260640160405180910390fd5b5f546040516370a0823160e01b815230600482015282916001600160a01b038084169263a9059cbb92919091169083906370a0823190602401602060405180830381865afa158015610281573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906102a591906104f9565b6040516001600160e01b031960e085901b1681526001600160a01b03909216600483015260248201526044016020604051808303815f875af11580156102ed573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061031191906104da565b505050565b6040516310ac2ddf60e21b81523060048201526001600160a01b0383811660248301526044820183905260a060648301525f60a4830181905260848301527f000000000000000000000000000000000000000000000000000000000000000016906342b0b77c9060c4015f604051808303815f87803b158015610397575f5ffd5b505af11580156103a9573d5f5f3e3d5ffd5b505050505050565b80356001600160a01b03811681146103c7575f5ffd5b919050565b5f5f5f5f5f5f60a087890312156103e1575f5ffd5b6103ea876103b1565b95506020870135945060408701359350610406606088016103b1565b9250608087013567ffffffffffffffff811115610421575f5ffd5b8701601f81018913610431575f5ffd5b803567ffffffffffffffff811115610447575f5ffd5b896020828401011115610458575f5ffd5b60208201935080925050509295509295509295565b5f6020828403121561047d575f5ffd5b610486826103b1565b9392505050565b5f5f6040838503121561049e575f5ffd5b6104a7836103b1565b946020939093013593505050565b808201808211156104d457634e487b7160e01b5f52601160045260245ffd5b92915050565b5f602082840312156104ea575f5ffd5b81518015158114610486575f5ffd5b5f60208284031215610509575f5ffd5b505191905056fea264697066735822122092b3da9ac7c1cfce44182d071393e111c40028b6d2c6b482266de8712de45df564736f6c63430008250033";

// Constructor: address _pool
const CONSTRUCTOR_ARG = AAVE_POOL_ADDRESS.toLowerCase().slice(2).padStart(64, "0");

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 DEPLOY AtomicFlashArb (2-step: Smart Account → Owner EOA → Deploy)");
  console.log("=".repeat(60));

  const signer = privateKeyToAccount(process.env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  console.log(`Owner EOA: ${signer.address}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
  });

  const bundlerUrl = `https://api.pimlico.io/v2/base/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const pimlicoClient = createPimlicoClient({ transport: http(bundlerUrl), chain: base });

  const safeAccount = await SafeSmartAccount.toSafeSmartAccount({
    client: publicClient,
    owners: [signer],
    entryPoint: { address: ENTRY_POINT as `0x${string}`, version: "0.6" },
    version: "1.4.1",
  });
  console.log(`Smart Account: ${safeAccount.address}`);

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

  // Check balances
  const saBalance = await publicClient.getBalance({ address: safeAccount.address as `0x${string}` });
  const ownerBalance = await publicClient.getBalance({ address: signer.address });
  console.log(`\nSmart Account balance: ${formatEther(saBalance)} ETH ($${(Number(formatEther(saBalance)) * 2650).toFixed(2)})`);
  console.log(`Owner EOA balance: ${formatEther(ownerBalance)} ETH ($${(Number(formatEther(ownerBalance)) * 2650).toFixed(2)})`);

  // STEP 1: Send ETH from Smart Account to Owner EOA (for deploy gas)
  const DEPLOY_GAS_ETH = "0.00015"; // ~$0.40 — affordable from $0.54 remaining
  
  if (Number(formatEther(ownerBalance)) < 0.0001) {
    console.log(`\n📤 Step 1: Sending ${DEPLOY_GAS_ETH} ETH from Smart Account → Owner EOA...`);
    
    const userOpHash = await smartAccountClient.sendUserOperation({
      calls: [{
        to: signer.address as `0x${string}`,
        value: parseEther(DEPLOY_GAS_ETH),
        data: "0x",
      }],
    });
    
    console.log(`   UserOp hash: ${userOpHash}`);
    const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });
    
    if (receipt.success) {
      console.log(`   ✅ ETH transferred to Owner EOA`);
      console.log(`   Tx: ${receipt.receipt?.transactionHash}`);
      // Wait for balance to sync
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log(`   ❌ Transfer failed`);
      process.exit(1);
    }
  } else {
    console.log(`\n✅ Owner EOA already has sufficient balance for deploy`);
  }

  // Check owner balance again
  const newOwnerBalance = await publicClient.getBalance({ address: signer.address });
  console.log(`\nOwner EOA new balance: ${formatEther(newOwnerBalance)} ETH`);

  if (Number(formatEther(newOwnerBalance)) < 0.0002) {
    console.log("❌ Still insufficient balance after transfer");
    process.exit(1);
  }

  // STEP 2: Deploy contract from Owner EOA
  console.log("\n📤 Step 2: Deploying contract from Owner EOA...");

  const walletClient = createWalletClient({
    chain: base,
    transport: http(process.env.ALCHEMY_BASE_RPC),
    account: signer,
  });

  // Encode constructor args
  const deployData = (BYTECODE + CONSTRUCTOR_ARG) as `0x${string}`;

  console.log(`   bytecode + constructor: ${deployData.length} chars`);

  const txHash = await walletClient.sendTransaction({
    account: signer,
    data: deployData,
    value: 0n,
    chain: base,
    gas: 450000n,  // slightly less gas
    maxFeePerGas: parseEther("0.0000000003"),  // 0.3 gwei (super low Base)
    maxPriorityFeePerGas: parseEther("0.0000000001"),  // 0.1 gwei priority
  });

  console.log(`   Deploy tx: ${txHash}`);
  console.log(`   Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "success") {
    const contractAddress = receipt.contractAddress;
    console.log(`\n✅ CONTRACT DEPLOYED!`);
    console.log(`   Address: ${contractAddress}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    console.log(`   Basescan: https://basescan.org/address/${contractAddress}`);

    // Transfer remaining ETH back to Smart Account
    const remainingBalance = await publicClient.getBalance({ address: signer.address });
    if (remainingBalance > 1000000000000n) { // > 0.000001 ETH
      console.log(`\n📤 Sending remaining ETH back to Smart Account...`);
      const returnTx = await walletClient.sendTransaction({
        account: signer,
        to: safeAccount.address as `0x${string}`,
        value: remainingBalance - 1000000000000n, // leave tiny amount for gas
        chain: base,
      });
      await publicClient.waitForTransactionReceipt({ hash: returnTx });
      console.log(`   ✅ Remaining ETH returned to Smart Account`);
    }

    // Save contract
    await fs.mkdir(path.dirname(CONTRACT_FILE), { recursive: true });
    await fs.writeFile(CONTRACT_FILE, JSON.stringify({
      address: contractAddress,
      smartAccount: safeAccount.address,
      deployer: signer.address,
      deployTx: txHash,
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
    process.exit(1);
  }
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
