import { NextResponse } from "next/server";
import { getLocalIntent, relayerBase, useRemoteRelayer } from "@/lib/sale-server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9]+$/i.test(id)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "id inválido" } },
      { status: 400 },
    );
  }

  if (useRemoteRelayer()) {
    try {
      const res = await fetch(`${relayerBase()}/intent/${id}`, { cache: "no-store" });
      const json = await res.json();
      return NextResponse.json(json, { status: res.status });
    } catch {
      return NextResponse.json(
        { error: { code: "relayer_down", message: "Sale relayer offline" } },
        { status: 503 },
      );
    }
  }

  const data = getLocalIntent(id);
  if (!data) {
    return NextResponse.json(
      { error: { code: "not_found", message: "intent não encontrada" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data });
}
