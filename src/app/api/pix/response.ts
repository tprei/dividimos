import { NextResponse } from "next/server";

/**
 * Every response is private and never cached — the body may carry a decrypted
 * Pix key embedded in the BR Code.
 */
export function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
