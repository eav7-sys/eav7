import { NextResponse } from "next/server";

/** Public sale confirm is ops/watcher-only — never grant from the browser. */
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
