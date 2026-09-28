const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractPath = path.join(process.cwd(), 'contracts', 'SimpleFlashLoanArb.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'SimpleFlashLoanArb.sol': { content: source }
  },
  settings: {
    outputSelection: { '*': { '*': ['*'] } },
    optimizer: { enabled: true, runs: 200 }, viaIR: true
  }
};

console.log('Compiling SimpleFlashLoanArb.sol...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === 'error');
  if (errors.length > 0) {
    errors.forEach(e => console.log('❌', e.formattedMessage || e.message));
    process.exit(1);
  }
}

if (output.contracts && output.contracts['SimpleFlashLoanArb.sol']) {
  for (const [name, contract] of Object.entries(output.contracts['SimpleFlashLoanArb.sol'])) {
    console.log(`\n✅ Compiled: ${name}`);
    console.log(`Bytecode length: ${contract.evm.bytecode.object.length} chars`);
    
    const bytecodeFile = path.join(process.cwd(), 'wallet-data', 'SimpleFlashLoanArb-bytecode.json');
    fs.mkdirSync(path.dirname(bytecodeFile), { recursive: true });
    fs.writeFileSync(bytecodeFile, JSON.stringify({
      contractName: name,
      bytecode: '0x' + contract.evm.bytecode.object,
      abi: contract.abi,
      compiledAt: new Date().toISOString(),
    }, null, 2));
    
    console.log(`💾 Bytecode saved to: ${bytecodeFile}`);
    console.log(`Bytecode: 0x${contract.evm.bytecode.object.slice(0, 100)}...`);
    
    // Show constructor
    const constructor = contract.abi.find(a => a.type === 'constructor');
    if (constructor) {
      console.log('\nConstructor inputs:');
      for (const inp of constructor.inputs) {
        console.log(`  - ${inp.name}: ${inp.type}`);
      }
    }
  }
}
