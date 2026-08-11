import { NextResponse } from "next/server";

/**
 * Public HTTP confirm is disabled.
 * Payment matching is done by the local relayer watcher; manual confirm is
 * ops-only (`SALE_OPS_TOKEN` + CLI / authenticated relayer /confirm).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "confirm_disabled",
        message:
          "Manual confirm is not exposed on the public API. Wait for the payment watcher or use ops CLI.",
      },
    },
    { status: 403 },
  );
}
