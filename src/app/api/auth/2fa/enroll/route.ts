import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Autenticação de dois fatores não está mais disponível" },
    { status: 410 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Autenticação de dois fatores não está mais disponível" },
    { status: 410 },
  );
}
