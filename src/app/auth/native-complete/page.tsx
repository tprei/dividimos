"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function NativeCompleteContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("Autenticando...");

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const state = searchParams.get("state");

    if (!accessToken || !refreshToken || !state) {
      setStatus("Erro na autenticação.");
      return;
    }

    fetch("/api/auth/native-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
    }).then((res) => {
      if (res.ok) {
        setStatus("Pronto! Pode fechar esta janela.");
      } else {
        setStatus("Erro ao salvar sessão.");
      }
    });
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-lg font-semibold">{status}</p>
      </div>
    </div>
  );
}

export default function NativeCompletePage() {
  return (
    <Suspense>
      <NativeCompleteContent />
    </Suspense>
  );
}
