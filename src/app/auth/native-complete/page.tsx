"use client";

import { useEffect, useState } from "react";

export default function NativeCompletePage() {
  const [status, setStatus] = useState("Autenticando...");

  useEffect(() => {
    const fullUrl = window.location.href;
    const hash = window.location.hash.substring(1);
    const search = window.location.search;

    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(search);

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const state = queryParams.get("state");

    if (!accessToken || !refreshToken) {
      setStatus(`Debug: no tokens. hash=${hash.substring(0, 100)} search=${search.substring(0, 100)} url=${fullUrl.substring(0, 200)}`);
      return;
    }

    if (!state) {
      setStatus(`Debug: tokens found but no state. search=${search}`);
      return;
    }

    fetch("/api/auth/native-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, access_token: accessToken, refresh_token: refreshToken }),
    }).then((res) => {
      setStatus(res.ok ? "Pronto! Pode fechar esta janela." : "Erro ao salvar sessão.");
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <p className="text-sm break-all">{status}</p>
    </div>
  );
}
