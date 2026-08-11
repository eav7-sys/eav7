import { NextResponse } from "next/server";
import { convertAmount } from "@/lib/price-market";

export const dynamic = "force-dynamic";

/**
 * GET /price/convert?amount=100&from=EAV7&to=USD
 * GET /price/convert?amount=50&from=USD&to=EAV7
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const amount = Number(url.searchParams.get("amount"));
  const from = url.searchParams.get("from") ?? "EAV7";
  const to = url.searchParams.get("to") ?? "USD";

  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: { code: "bad_amount", message: "amount must be a non-negative number" } },
      { status: 400 },
    );
  }

  try {
    const data = convertAmount(amount, from, to);
    return NextResponse.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "unsupported_pair",
          message: e instanceof Error ? e.message : "unsupported pair",
        },
      },
      { status: 400 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
