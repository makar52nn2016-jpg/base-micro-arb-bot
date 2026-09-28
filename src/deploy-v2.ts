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
const BYTECODE = "0x60a03461008a57601f610bf438819003918201601f19168301916001600160401b0383118484101761008e5780849260209460405283398101031261008a57516001600160a01b0381169081900361008a576080525f80546001600160a01b03191633179055604051610b5190816100a3823960805181818160e7015281816101dd01526103aa0152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe608080604052600436101561001c575b50361561001a575f80fd5b005b5f905f3560e01c9081631b11d0ff146103445750806351cff8d91461020c5780637535d246146101c85780638da5cb5b146101a15763f8a350a10361000f573461019d5760c036600319011261019d57610074610952565b6044359060ff821680920361019d5760643560ff811680910361019d576084356001600160a01b0381169081900361019d5760a4356001600160a01b038116919082900361019d576040519260208401958652604084015260608301526080820152608081526100e560a0826109a0565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316803b1561019d575f928360c46040518097819682956310ac2ddf60e21b845230600485015260018060a01b03166024840152602435604484015260a060648401525180918160a48501528484015e83838284010152836084830152601f801991011681010301925af1801561019257610186575080f35b61001a91505f906109a0565b6040513d5f823e3d90fd5b5f80fd5b3461019d575f36600319011261019d575f546040516001600160a01b039091168152602090f35b3461019d575f36600319011261019d576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b3461019d57602036600319011261019d57610225610952565b5f546001600160a01b03169033829003610312576040516370a0823160e01b81523060048201526001600160a01b039190911691602082602481865afa918215610192575f926102dc575b5060405163a9059cbb60e01b81526001600160a01b0390911660048201526024810191909152906020908290815f81604481015b03925af18015610192576102b457005b61001a9060203d6020116102d5575b6102cd81836109a0565b8101906109d6565b503d6102c3565b91506020823d60201161030a575b816102f7602093836109a0565b8101031261019d579051906102a4610270565b3d91506102ea565b60405162461bcd60e51b815260206004820152600a60248201526927b7363c9037bbb732b960b11b6044820152606490fd5b3461019d5760a036600319011261019d5761035d610952565b60243590610369610968565b506084359067ffffffffffffffff821161019d573660238301121561019d57816004013567ffffffffffffffff811161019d57820136602482011161019d577f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316943386900361091f57506080908390031261019d576103f36024830161097e565b906104006044840161097e565b9261041960846104126064840161098c565b920161098c565b506040516370a0823160e01b81523060048201526001600160a01b039190911692602082602481875afa918215610192575f926108ea575b5060ff16156107e4575b6040516370a0823160e01b815230600482015290602082602481875afa8015610192575f906107b0575b61048f9250610b0e565b6040516370a0823160e01b81523060048201526001600160a01b03909216939091602081602481885afa80156101925761077f575b5060ff1660011461067a575b50506040516370a0823160e01b815230600482015292602084602481855afa938415610192575f94610646575b506044358301809311610632578284106105f85760405163095ea7b360e01b81526001600160a01b03919091166004820152602481018390526020816044815f865af18015610192576105db575b5081831161055f575b602060405160018152f35b61056e6020926105a694610b0e565b5f805460405163a9059cbb60e01b81526001600160a01b03909116600482015260248101929092529093849291839182906044820190565b03925af18015610192576105bc575b8080610554565b6105d49060203d6020116102d5576102cd81836109a0565b50806105b5565b6105f39060203d6020116102d5576102cd81836109a0565b61054b565b60405162461bcd60e51b8152602060048201526012602482015271417262206e6f742070726f66697461626c6560701b6044820152606490fd5b634e487b7160e01b5f52601160045260245ffd5b9093506020813d602011610672575b81610662602093836109a0565b8101031261019d575192846104fd565b3d9150610655565b60405163095ea7b360e01b815273cf77a3ba9a5ca399b7c97c74d54e5b1beb874e43600482015260248101829052916020836044815f855af191821561019257610715935f93610762575b50604051916106d56060846109a0565b6002835260403660208501376106ea836109ee565b52846106f583610a0f565b526040516338ed173960e01b815293849283924291309160048601610aa5565b03818373cf77a3ba9a5ca399b7c97c74d54e5b1beb874e435af1801561019257610740575b806104d0565b61075b903d805f833e61075381836109a0565b810190610a1f565b508361073a565b61077a9060203d6020116102d5576102cd81836109a0565b6106c5565b6020813d6020116107a8575b81610798602093836109a0565b8101031261019d575060ff6104c4565b3d915061078b565b506020823d6020116107dc575b816107ca602093836109a0565b8101031261019d5761048f9151610485565b3d91506107bd565b60405163095ea7b360e01b815273cf77a3ba9a5ca399b7c97c74d54e5b1beb874e436004820152602481018690526001600160a01b0383166020826044815f855af190811561019257610888925f926108cd575b50604051906108486060836109a0565b60028252604036602084013761085d826109ee565b528561086882610a0f565b52604051809381926338ed173960e01b8352429030908c60048601610aa5565b03818373cf77a3ba9a5ca399b7c97c74d54e5b1beb874e435af18015610192576108b3575b5061045b565b6108c6903d805f833e61075381836109a0565b50866108ad565b6108e59060203d6020116102d5576102cd81836109a0565b610838565b9091506020813d602011610917575b81610906602093836109a0565b8101031261019d57519060ff610451565b3d91506108f9565b62461bcd60e51b815260206004820152600e60248201526d13db9b1e4810585d9948141bdbdb60921b6044820152606490fd5b600435906001600160a01b038216820361019d57565b606435906001600160a01b038216820361019d57565b359060ff8216820361019d57565b35906001600160a01b038216820361019d57565b90601f8019910116810190811067ffffffffffffffff8211176109c257604052565b634e487b7160e01b5f52604160045260245ffd5b9081602091031261019d5751801515810361019d5790565b8051156109fb5760200190565b634e487b7160e01b5f52603260045260245ffd5b8051600110156109fb5760400190565b60208183031261019d5780519067ffffffffffffffff821161019d57019080601f8301121561019d5781519167ffffffffffffffff83116109c2578260051b906020820193610a7160405195866109a0565b845260208085019282010192831161019d57602001905b828210610a955750505090565b8151815260209182019101610a88565b91909493929460a083019083525f602084015260a060408401528151809152602060c084019201905f5b818110610aef575050506001600160a01b03909416606082015260800152565b82516001600160a01b0316845260209384019390920191600101610acf565b919082039182116106325756fea2646970667358221220bc9635e8f5d59024f0bcc293769923b4b53a6d85888ee3bc5e345156daa6bb1864736f6c63430008250033";

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
  const DEPLOY_GAS_ETH = "0.0004"; // ~$0.40 — affordable from $0.54 remaining
  
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
    gas: 1000000n,  // V2 is large, need 1M gas
    maxFeePerGas: parseEther("0.0000000003"),  // 0.3 gwei
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
