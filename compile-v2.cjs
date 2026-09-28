// Compile FlashLoanArbV2.sol
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractPath = path.join(process.cwd(), 'contracts', 'FlashLoanArbV2.sol');
const source = fs.readFileSync(contractPath, 'utf8');

function findImports(importPath) {
  try {
    const p = path.join(process.cwd(), 'node_modules', importPath);
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, 'utf8') };
    if (fs.existsSync(importPath)) return { contents: fs.readFileSync(importPath, 'utf8') };
    return { error: `File not found: ${importPath}` };
  } catch (e) {
    return { error: `Error: ${e.message}` };
  }
}

const input = {
  language: 'Solidity',
  sources: { 'FlashLoanArbV2.sol': { content: source } },
  settings: {
    outputSelection: { '*': { '*': ['*'] } },
    optimizer: { enabled: true, runs: 200 }, viaIR: true
  }
};

console.log('Compiling FlashLoanArbV2.sol...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === 'error');
  errors.forEach(e => console.log('❌', e.formattedMessage?.slice(0, 200) || e.message?.slice(0, 200)));
  if (errors.length > 0) process.exit(1);
}

if (output.contracts && output.contracts['FlashLoanArbV2.sol']) {
  for (const [name, contract] of Object.entries(output.contracts['FlashLoanArbV2.sol'])) {
    if (contract.evm.bytecode.object.length === 0) continue;
    console.log(`\n✅ Compiled: ${name}`);
    console.log(`Bytecode length: ${contract.evm.bytecode.object.length} chars`);
    
    const outFile = path.join(process.cwd(), 'wallet-data', 'FlashLoanArbV2-bytecode.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({
      contractName: name,
      bytecode: '0x' + contract.evm.bytecode.object,
      abi: contract.abi,
      compiledAt: new Date().toISOString(),
    }, null, 2));
    
    console.log(`💾 Saved to: ${outFile}`);
    
    const constructor = contract.abi.find(a => a.type === 'constructor');
    if (constructor) {
      console.log('Constructor:');
      constructor.inputs.forEach(i => console.log(`  - ${i.name}: ${i.type}`));
    }
    
    // Print requestFlashLoan function ABI
    const rfl = contract.abi.find(a => a.name === 'requestFlashLoan');
    if (rfl) {
      console.log('\nrequestFlashLoan ABI:');
      rfl.inputs.forEach(i => console.log(`  - ${i.name}: ${i.type}`));
    }
  }
}
