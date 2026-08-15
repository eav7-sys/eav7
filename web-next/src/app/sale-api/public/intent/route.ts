import { NextResponse } from "next/server";
import {
  createLocalIntent,
  relayerBase,
  useRemoteRelayer,
} from "@/lib/sale-server";

function bad(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad(400, "bad_request", "JSON inválido");
  }

  const beneficiary0x = String(body.beneficiary0x || "");
  const rail = String(body.rail || body.railId || "");
  const usdAmount = Number(body.usdAmount);

  if (!/^0x[0-9a-fA-F]{40}$/.test(beneficiary0x)) {
    return bad(400, "bad_request", "beneficiary0x inválido");
  }
  if (!rail) return bad(400, "bad_request", "rail obrigatória");
  if (!(usdAmount >= 100)) return bad(400, "bad_request", "usdAmount mínimo 100");

  if (useRemoteRelayer("public") && process.env.SALE_RELAYER_PUBLIC_URL) {
    try {
      const res = await fetch(`${relayerBase("public")}/intent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ beneficiary0x, rail, usdAmount }),
        cache: "no-store",
      });
      const json = await res.json();
      return NextResponse.json(json, { status: res.status });
    } catch {
      return bad(503, "relayer_down", "Public relayer offline");
    }
  }

  try {
    const data = createLocalIntent({ beneficiary0x, rail, usdAmount }, "public");
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return bad(400, "bad_request", e instanceof Error ? e.message : String(e));
  }
}
