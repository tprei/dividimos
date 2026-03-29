import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSefazPage, parseSefazPage } from "@/lib/nfce";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json(
      { error: "Campo 'url' obrigatorio" },
      { status: 400 },
    );
  }

  const url = body.url.trim();

  // Validate URL points to a known SEFAZ domain
  const SEFAZ_DOMAIN_PATTERN = /\.(fazenda|sefaz|sef)\.[a-z]{2}\.gov\.br$/i;
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

  if (!fetchResult.ok || !fetchResult.html) {
    return NextResponse.json(
      {
        error: fetchResult.error ?? "Falha ao acessar pagina da SEFAZ",
        fallback: true,
      },
      { status: 502 },
    );
  }

  const result = parseSefazPage(fetchResult.html);

  if (!result || result.items.length === 0) {
    return NextResponse.json(
      {
        error: "Nao foi possivel extrair itens da pagina",
        fallback: true,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result);
}
