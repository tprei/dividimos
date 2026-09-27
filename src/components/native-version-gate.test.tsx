import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as NativeVersionModule from "@/lib/native-version";

const { getPlatform, getInfo, open, minimums, mountSpy } = vi.hoisted(() => ({
  getPlatform: vi.fn(() => "web"),
  getInfo: vi.fn(),
  open: vi.fn(),
  minimums: { android: 0, ios: 0 } as Record<"android" | "ios", number>,
  mountSpy: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform },
}));

vi.mock("@capacitor/app", () => ({
  App: { getInfo },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open },
}));

vi.mock("@/lib/native-version", async () => {
  const actual = await vi.importActual<typeof NativeVersionModule>(
    "@/lib/native-version",
  );
  return { ...actual, MINIMUM_NATIVE_BUILDS: minimums };
});

import { NativeVersionGate } from "./native-version-gate";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ai.dividimos.app";
const UPDATE_HEADING = "Atualize o Dividimos";
const CHECK_ERROR_HEADING = "Não foi possível verificar a versão";

function RouteChild({ label }: { label: string }) {
  useEffect(() => {
    mountSpy(label);
  }, [label]);
  return <p>Conteúdo da rota: {label}</p>;
}

function renderGate(label: string) {
  return render(
    <NativeVersionGate>
      <RouteChild label={label} />
    </NativeVersionGate>,
  );
}

describe("NativeVersionGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    minimums.android = 0;
    minimums.ios = 0;
  });

  it("replaces route children once the build is below the minimum", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "9" });

    renderGate("rota");
    expect(screen.getByText("Conteúdo da rota: rota")).toBeInTheDocument();

    await screen.findByRole("heading", { name: UPDATE_HEADING });
    expect(screen.queryByText("Conteúdo da rota: rota")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar na Play Store" })).toBeEnabled();
  });

  it("renders route children unchanged on web with an active minimum", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("web");
    getInfo.mockRejectedValue(new Error("não deve ler a versão nativa"));

    renderGate("rota");

    await waitFor(() => expect(getPlatform).toHaveBeenCalled());
    expect(screen.getByText("Conteúdo da rota: rota")).toBeInTheDocument();
    expect(getInfo).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: UPDATE_HEADING })).not.toBeInTheDocument();
  });

  it("keeps every route child unmounted below the minimum", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "9" });

    const { rerender } = renderGate("inicial");
    await screen.findByRole("heading", { name: UPDATE_HEADING });

    rerender(
      <NativeVersionGate>
        <RouteChild label="auth" />
      </NativeVersionGate>,
    );
    rerender(
      <NativeVersionGate>
        <RouteChild label="app" />
      </NativeVersionGate>,
    );

    expect(screen.queryByText("Conteúdo da rota: auth")).not.toBeInTheDocument();
    expect(screen.queryByText("Conteúdo da rota: app")).not.toBeInTheDocument();
    expect(mountSpy).not.toHaveBeenCalledWith("auth");
    expect(mountSpy).not.toHaveBeenCalledWith("app");
    expect(screen.getByRole("heading", { name: UPDATE_HEADING })).toBeInTheDocument();
  });

  it("releases children at the minimum", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "10" });

    renderGate("rota");

    await waitFor(() => expect(getInfo).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Conteúdo da rota: rota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: UPDATE_HEADING })).not.toBeInTheDocument();
  });

  it("passes web through without reading native app info", async () => {
    getPlatform.mockReturnValue("web");
    getInfo.mockRejectedValue(new Error("não deve ler a versão nativa"));

    renderGate("rota");

    await waitFor(() => expect(getPlatform).toHaveBeenCalled());
    expect(getInfo).not.toHaveBeenCalled();
    expect(screen.getByText("Conteúdo da rota: rota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CHECK_ERROR_HEADING })).not.toBeInTheDocument();
  });

  it("passes a disabled native platform through without reading native app info", async () => {
    getPlatform.mockReturnValue("android");
    getInfo.mockRejectedValue(new Error("não deve ler a versão nativa"));

    renderGate("rota");

    await waitFor(() => expect(getPlatform).toHaveBeenCalled());
    expect(getInfo).not.toHaveBeenCalled();
    expect(screen.getByText("Conteúdo da rota: rota")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CHECK_ERROR_HEADING })).not.toBeInTheDocument();
  });

  it("keeps children blocked when the build is malformed", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "12abc" });

    renderGate("rota");

    await screen.findByRole("heading", { name: CHECK_ERROR_HEADING });
    expect(screen.queryByText("Conteúdo da rota: rota")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("keeps children blocked when the native info read rejects", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockRejectedValue(new Error("ponte nativa indisponível"));

    renderGate("rota");

    await screen.findByRole("heading", { name: CHECK_ERROR_HEADING });
    expect(screen.queryByText("Conteúdo da rota: rota")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("opens Google Play without unlocking the application", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "9" });
    let resolveOpen: (() => void) | undefined;
    open.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    renderGate("rota");
    const cta = await screen.findByRole("button", { name: "Atualizar na Play Store" });
    fireEvent.click(cta);

    const busy = await screen.findByRole("button", { name: "Abrindo a Play Store…" });
    expect(busy).toBeDisabled();
    await waitFor(() => expect(open).toHaveBeenCalledWith({ url: PLAY_STORE_URL }));

    resolveOpen?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Atualizar na Play Store" }),
      ).toBeEnabled(),
    );
    const openedStatus = screen.getByRole("status");
    expect(openedStatus).toHaveTextContent(
      "Depois de instalar a atualização, abra o Dividimos de novo.",
    );
    expect(screen.getByRole("heading", { name: UPDATE_HEADING })).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo da rota: rota")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Atualizar na Play Store" }),
    ).toBeEnabled();
  });

  it("keeps the update action retryable after the store fails to open", async () => {
    minimums.android = 10;
    getPlatform.mockReturnValue("android");
    getInfo.mockResolvedValue({ build: "9" });
    open.mockRejectedValueOnce(new Error("Play Store indisponível"));

    renderGate("rota");
    const cta = await screen.findByRole("button", { name: "Atualizar na Play Store" });
    fireEvent.click(cta);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível abrir a Play Store. Tente novamente.");
    const retry = screen.getByRole("button", { name: "Atualizar na Play Store" });
    expect(retry).toBeEnabled();

    open.mockResolvedValueOnce(undefined);
    fireEvent.click(retry);

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: UPDATE_HEADING })).toBeInTheDocument();
    expect(screen.queryByText("Conteúdo da rota: rota")).not.toBeInTheDocument();
  });
});
