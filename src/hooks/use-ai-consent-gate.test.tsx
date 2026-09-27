import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAiConsentGate } from "./use-ai-consent-gate";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { __resetAiConsentForTests, grantAiConsent, hasAiConsent } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import type { Me } from "@/types/ledger";

function makeMe(id: string): Me {
  return {
    id,
    email: `${id}@example.com`,
    handle: id,
    name: id,
    avatarUrl: null,
    isBot: false,
    pixKeyType: "email",
    pixKeyHint: "",
    onboarded: true,
    notificationPreferences: {},
  };
}

function GateHarness({
  onAction,
  onDecline,
}: {
  onAction: () => void;
  onDecline?: () => void;
}) {
  const { requestConsent, dialogProps } = useAiConsentGate();
  return (
    <div>
      <button type="button" onClick={() => requestConsent(onAction, onDecline)}>
        Pedir permissão
      </button>
      <AiConsentDialog {...dialogProps} />
    </div>
  );
}

beforeEach(() => {
  __resetAiConsentForTests();
  useAppStore.setState({ me: makeMe("user-a") });
});

afterEach(() => {
  useAppStore.setState({ me: null });
});

describe("useAiConsentGate", () => {
  it("runs the action immediately when consent is already granted", async () => {
    grantAiConsent("user-a");
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
  });

  it("opens the dialog and runs nothing while consent is missing", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
  });

  it("grants consent and runs the action once on accept", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));
    await user.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(hasAiConsent("user-a")).toBe(true);
    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
  });

  it("decline runs onDecline and never the action", async () => {
    const onAction = vi.fn();
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));
    await user.click(screen.getByRole("button", { name: "Continuar sem IA" }));

    expect(onAction).not.toHaveBeenCalled();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(hasAiConsent("user-a")).toBe(false);
    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
  });

  it("closes the dialog without running anything when the account switches", async () => {
    const onAction = vi.fn();
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} onDecline={onDecline} />);

    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));
    expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();

    await act(async () => {
      useAppStore.setState({ me: makeMe("user-b") });
    });

    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with an error and runs nothing when the device refuses the write", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<GateHarness onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));

    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await user.click(screen.getByRole("button", { name: "Permitir uso de IA" }));

    expect(onAction).not.toHaveBeenCalled();
    expect(hasAiConsent("user-a")).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu pra salvar");

    setItem.mockRestore();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(hasAiConsent("user-a")).toBe(true);
  });

  it("does not reopen an abandoned request when the first account comes back", async () => {
    const user = userEvent.setup();
    render(<GateHarness onAction={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Pedir permissão" }));

    await act(async () => {
      useAppStore.setState({ me: makeMe("user-b") });
    });
    await act(async () => {
      useAppStore.setState({ me: makeMe("user-a") });
    });

    expect(screen.queryByText("Usar IA no Dividimos?")).not.toBeInTheDocument();
  });
});
