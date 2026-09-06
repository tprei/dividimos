import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle")?.toLowerCase().trim();

  if (!handle) {
    return NextResponse.json({ error: "Handle obrigatorio" }, { status: 400 });
  }

  const { data: profile } = await supabase.rpc("lookup_user_by_handle", {
    p_handle: handle,
  });

  if (!profile) {
    return NextResponse.json({ error: "Usuario nao encontrado" }, { status: 404 });
  }

  return NextResponse.json({ profile });
}
