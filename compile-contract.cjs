// Compile FlashLoanSimple.sol using solc with import resolution
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractPath = path.join(process.cwd(), 'contracts', 'FlashLoanSimple.sol');
const source = fs.readFileSync(contractPath, 'utf8');

// Custom import resolver
function findImports(importPath) {
  try {
    // Try node_modules
    const nodeModulePath = path.join(process.cwd(), 'node_modules', importPath);
    if (fs.existsSync(nodeModulePath)) {
      return { contents: fs.readFileSync(nodeModulePath, 'utf8') };
    }
    // Try relative path
    if (fs.existsSync(importPath)) {
      return { contents: fs.readFileSync(importPath, 'utf8') };
    }
    return { error: `File not found: ${importPath}` };
  } catch (e) {
    return { error: `Error reading ${importPath}: ${e.message}` };
  }
}

const input = {
  language: 'Solidity',
  sources: {
    'FlashLoanSimple.sol': { content: source }
  },
  settings: {
    outputSelection: { '*': { '*': ['*'] } },
    optimizer: { enabled: true, runs: 200 }
  }
};

console.log('Compiling FlashLoanSimple.sol...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  const errors = output.errors.filter(e => e.severity === 'error');
  const warnings = output.errors.filter(e => e.severity === 'warning');
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warnings (safe to ignore):`);
    warnings.forEach(w => console.log(`  ⚠ ${w.formattedMessage?.slice(0, 100) || w.message?.slice(0, 100)}`));
  }
  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} errors:`);
    errors.forEach(e => console.log(`  ✗ ${e.formattedMessage || e.message}`));
    process.exit(1);
  }
}

if (output.contracts && output.contracts['FlashLoanSimple.sol']) {
  for (const [name, contract] of Object.entries(output.contracts['FlashLoanSimple.sol'])) {
    console.log(`\n✅ Compiled: ${name}`);
    console.log(`Bytecode length: ${contract.evm.bytecode.object.length} chars`);
    
    // Save bytecode
    const bytecodeFile = path.join(process.cwd(), 'wallet-data', 'FlashLoanSimple-bytecode.json');
    fs.mkdirSync(path.dirname(bytecodeFile), { recursive: true });
    fs.writeFileSync(bytecodeFile, JSON.stringify({
      contractName: name,
      bytecode: '0x' + contract.evm.bytecode.object,
      abi: contract.abi,
      compiledAt: new Date().toISOString(),
      solcVersion: solc.version(),
    }, null, 2));
    
    console.log(`\n💾 Bytecode saved to: ${bytecodeFile}`);
    console.log(`\nBytecode (first 300 chars):`);
    console.log('0x' + contract.evm.bytecode.object.slice(0, 300) + '...');
  }
} else {
  console.log('❌ No contracts in output');
  console.log(JSON.stringify(output, null, 2).slice(0, 1000));
}
