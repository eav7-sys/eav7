/**
 * Gera fragmento de gênese §12.2 + PublicVault / SaleVault / PartnerTrancheVault
 * + 7 Âncoras (10k stake cada) + restante da fundação em vesting.
 *
 * Uso:
 *   node contracts/scripts/genesis-buckets.mjs \
 *     --public-vault E7… \
 *     --sale-vault E7… \
 *     --partner-vault E7…
 *
 * Foundation treasury (default): E7F2906EA4B2CD23D20180C8E813F2D126
 * Âncoras: contracts/sale/foundation-ancoras.json
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GENESIS_SUPPLY = 100_000_000_000_000_000n; // 100B * 1e6
const GENESIS_STAKE = 10_000_000_000n; // 10_000 EAV7

/** Tesouraria fundação — endereço que o operador já publicou nas rails. */
const DEFAULT_FOUNDATION_TREASURY = "E7F2906EA4B2CD23D20180C8E813F2D126";

const PUBLIC = (GENESIS_SUPPLY * 45n) / 100n;
const FOUNDATION = (GENESIS_SUPPLY * 3025n) / 10_000n;
const PRIVATE = (GENESIS_SUPPLY * 1475n) / 10_000n;
const PARTNER = (GENESIS_SUPPLY * 10n) / 100n;

const CLIFF_12M = 31_536_000;
const DUR_FOUNDATION_FROM_START = 157_680_000;

const { values } = parseArgs({
  options: {
    "public-vault": { type: "string" },
    "sale-vault": { type: "string" },
    "partner-vault": { type: "string" },
    "ecosystem-vault": { type: "string" },
    partner: { type: "string" },
    foundation: { type: "string" },
    "anchors-file": { type: "string" },
    founder: { type: "string" },
  },
});

function req(name) {
  const v = values[name];
  if (!v) {
    console.error(`missing --${name}`);
    process.exit(1);
  }
  return v;
}

const publicVault = req("public-vault");
const saleVault = req("sale-vault");
const partnerVault =
  values["partner-vault"] || values["ecosystem-vault"] || values.partner;
if (!partnerVault) {
  console.error("missing --partner-vault");
  process.exit(1);
}

const anchorsPath =
  values["anchors-file"] || path.join(ROOT, "sale/foundation-ancoras.json");

let anchors = [];
let foundationFromFile = null;
if (fs.existsSync(anchorsPath)) {
  const reg = JSON.parse(fs.readFileSync(anchorsPath, "utf8"));
  anchors = (reg.anchors || []).map((a) => a.e7).filter(Boolean);
  foundationFromFile = reg.treasury?.e7 || reg.genesis?.vestingFoundation?.beneficiary || null;
} else if (values.founder) {
  anchors = [values.founder];
} else {
  console.error(`missing anchors file: ${anchorsPath}`);
  process.exit(1);
}

const foundation =
  values.foundation || foundationFromFile || DEFAULT_FOUNDATION_TREASURY;

if (anchors.length < 5 || anchors.length > 7) {
  console.error(`launch anchors must be 5..7, got ${anchors.length}`);
  process.exit(1);
}

const stakeTotal = GENESIS_STAKE * BigInt(anchors.length);
const foundationVested = FOUNDATION - stakeTotal;
if (foundationVested <= 0n) {
  console.error("FOUNDATION <= N×STAKE");
  process.exit(1);
}

const sum = PUBLIC + PRIVATE + foundationVested + PARTNER + stakeTotal;
if (sum !== GENESIS_SUPPLY) {
  console.error("supply mismatch", String(sum), String(GENESIS_SUPPLY));
  process.exit(1);
}

const tranche = PARTNER / 4n;
const stakes = Object.fromEntries(
  anchors.map((a) => [a, GENESIS_STAKE.toString()]),
);

const eav7 = (atomic) => (atomic / 1_000_000n).toString();

const out = {
  comment:
    "§12.2 — PublicVault / SaleVault / PartnerTrancheVault; 7 Âncoras × 10k stake; restante fundação → E7F2906… (vesting)",
  balances: {
    [publicVault]: PUBLIC.toString(),
    [saleVault]: PRIVATE.toString(),
    [partnerVault]: PARTNER.toString(),
  },
  stakes,
  bridgeRelayers: [],
  vesting: [
    {
      id: "foundation",
      beneficiary: foundation,
      total: foundationVested.toString(),
      cliff: CLIFF_12M,
      duration: DUR_FOUNDATION_FROM_START,
    },
  ],
  meta: {
    publicEav7: eav7(PUBLIC),
    privateSaleEav7: eav7(PRIVATE),
    partnerEav7: eav7(PARTNER),
    foundationBucketEav7: eav7(FOUNDATION),
    foundationStakeToAnchorsEav7: eav7(stakeTotal),
    foundationVestedToTreasuryEav7: eav7(foundationVested),
    foundationTreasury: foundation,
    anchors: anchors.length,
    stakeEachEav7: eav7(GENESIS_STAKE),
    trancheEachEav7: eav7(tranche),
    note: "Treasury vesting is locked (12m cliff + 48m linear). Anchors only hold GENESIS_STAKE. bridgeRelayers starts empty.",
  },
};

console.log(JSON.stringify(out, null, 2));
