"use client";

// Ícones EAV7 — Phosphor (duotone) para um visual profissional e coeso.
// Mesmos nomes de export do set anterior: trocar aqui atualiza o site inteiro.
import {
  Cube,
  ArrowsLeftRight,
  ShieldCheck,
  Path,
  Fingerprint,
  Lightning,
  Coins,
  Pulse,
  Stack,
  Flame,
  Tray,
  Brain,
  Timer,
  ShareNetwork,
  Medal,
  Database,
  Wallet,
  Code,
  MagnifyingGlass,
  ArrowUpRight,
  Sun,
  Moon,
  Globe,
  Check,
  X,
  Copy as CopyGlyph,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";

interface P {
  size?: number;
  className?: string;
}

function wrap(C: Icon, weight: IconWeight = "duotone") {
  function Wrapped({ size = 18, className }: P) {
    return <C size={size} weight={weight} className={className} />;
  }
  return Wrapped;
}

export const IconBlock = wrap(Cube);
export const IconTx = wrap(ArrowsLeftRight);
export const IconValidator = wrap(ShieldCheck);
export const IconBridge = wrap(Path);
export const IconQuantumKey = wrap(Fingerprint);
export const IconEnergy = wrap(Lightning);
export const IconToken = wrap(Coins);
export const IconPulse = wrap(Pulse);
export const IconLayers = wrap(Stack);
export const IconFlame = wrap(Flame);
export const IconMempool = wrap(Tray);
export const IconAi = wrap(Brain);
export const IconTimer = wrap(Timer);
export const IconNetwork = wrap(ShareNetwork);
export const IconReward = wrap(Medal);
export const IconSupply = wrap(Database);
export const IconWallet = wrap(Wallet);
export const IconCode = wrap(Code);
export const IconSun = wrap(Sun, "bold");
export const IconMoon = wrap(Moon, "bold");
export const IconSearch = wrap(MagnifyingGlass, "bold");
export const IconArrowUpRight = wrap(ArrowUpRight, "bold");
export const IconGlobe = wrap(Globe);
export const IconCheck = wrap(Check, "bold");
export const IconX = wrap(X, "bold");
export const IconCopy = wrap(CopyGlyph, "regular");
