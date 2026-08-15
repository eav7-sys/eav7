import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const solc = require("solc");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function compile(file, contractName) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const input = {
    language: "Solidity",
    sources: { [file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      metadata: { bytecodeHash: "none" },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  if (fatal.length) {
    console.error(fatal.map((e) => e.formattedMessage).join("\n"));
    process.exit(1);
  }
  const c = out.contracts[file][contractName];
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "artifacts", `${contractName}.abi.json`),
    JSON.stringify(c.abi, null, 2),
  );
  fs.writeFileSync(path.join(root, "artifacts", `${contractName}.bin`), c.evm.bytecode.object);
  console.log("ok", contractName);
}

compile("PublicVault.sol", "PublicVault");
compile("TimelockLpSeeder.sol", "TimelockLpSeeder");
compile("EcosystemVault.sol", "EcosystemVault");
compile("PartnerTrancheVault.sol", "PartnerTrancheVault");
compile("SaleVault.sol", "SaleVault");
console.log("done");
