import { NextResponse } from "next/server";
import { lookupFailureResponse, lookupProfile } from "@/lib/profile-lookup";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle") ?? "";

  try {
    const profile = await lookupProfile(handle);
    if (!profile) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    const failure = lookupFailureResponse(error);
    if (!failure) throw error;
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
