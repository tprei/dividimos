import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchSefazPage,
  parseSefazPage,
  extractSefazAccessKeys,
  SEFAZ_DOMAIN_PATTERN,
} from "@/lib/nfce";

export const runtime = "nodejs";
export const maxDuration = 15;

const RECEIPT_ACCESS_KEY_PATTERN = /^\d{44}$/;

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json(
      { error: "Campo 'url' obrigatorio" },
      { status: 400 },
    );
  }

  // The expected 44-digit access key rides with the URL so the fetched page
  // can be bound to the scanned identity before any of its data is returned.
  // Validated up front, before any SEFAZ fetch happens.
  const receiptAccessKey =
    typeof body.receiptAccessKey === "string" ? body.receiptAccessKey.trim() : "";
  if (!RECEIPT_ACCESS_KEY_PATTERN.test(receiptAccessKey)) {
    return NextResponse.json(
      { error: "Campo 'receiptAccessKey' deve conter 44 digitos" },
      { status: 400 },
    );
  }

  const url = body.url.trim();

  // Validate URL points to a known SEFAZ domain. fetchSefazPage re-validates
  // every redirect hop against the same allowlist.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json(
        { error: "URL deve ser HTTP ou HTTPS" },
        { status: 400 },
      );
    }
    if (!SEFAZ_DOMAIN_PATTERN.test(parsed.hostname)) {
      return NextResponse.json(
        { error: "URL deve ser de um portal SEFAZ" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "URL invalida" }, { status: 400 });
  }

  const fetchResult = await fetchSefazPage(url);

  if (!fetchResult.ok || fetchResult.html === undefined) {
    return NextResponse.json(
      {
        error: fetchResult.error ?? "Falha ao acessar página da SEFAZ",
        fallback: true,
      },
      { status: 502 },
    );
  }

  // Identity gate: the page must declare exactly one distinct access key, in a
  // dedicated fiscal access-key field (never mere body text, links, scripts, or
  // the request URL), and it must equal the key the user scanned. Missing,
  // ambiguous, and mismatched identities all fail the same deterministic way.
  const pageAccessKeys = extractSefazAccessKeys(fetchResult.html);
  if (pageAccessKeys.length !== 1 || pageAccessKeys[0] !== receiptAccessKey) {
    return NextResponse.json(
      {
        error: "Não foi possível validar a identidade da nota fiscal",
        fallback: true,
      },
      { status: 422 },
    );
  }

  const result = parseSefazPage(fetchResult.html, receiptAccessKey);

  if (!result || result.items.length === 0) {
    return NextResponse.json(
      {
        error: "Não foi possível extrair itens da página",
        fallback: true,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result);
}
