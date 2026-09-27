import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { useAppStore } from "@/stores/app-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatAiInput } from "./chat-ai-input";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

const mockResult: ChatExpenseResult = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  splitType: "equal",
  allocations: [],
  items: [],
  participants: [],
  payerHandle: "SELF",
  merchantName: null,
  confidence: "high",
};

const defaultProps = {
  groupId: "group-1",
  onConfirmDraft: vi.fn().mockResolvedValue({ expenseId: "expense-1" }),
  onEditDraft: vi.fn(),
};

function setup(props = {}) {
  const user = userEvent.setup();
  const utils = render(<ChatAiInput {...defaultProps} {...props} />);
  return { user, ...utils };
}

function makeMe(id: string, granted: boolean) {
  return {
    id,
    handle: id,
    name: id,
    avatarUrl: null,
    isBot: false,
    email: `${id}@example.com`,
    pixKeyType: null,
    pixKeyHint: null,
    onboarded: true,
    notificationPreferences: {},
    aiConsentVersion: granted ? CURRENT_AI_CONSENT_VERSION : null,
    aiConsentGrantedAt: granted ? "2026-01-01T00:00:00.000Z" : null,
  };
}

function seedUsableAiConsent(): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: "user-1",
    lastBootstrappedGeneration: 0,
    me: {
      id: "user-1",
      handle: "alice",
      name: "Alice",
      avatarUrl: null,
      isBot: false,
      email: "alice@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {},
      aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
      aiConsentGrantedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

describe("ChatAiInput", () => {
  beforeEach(() => {
    seedUsableAiConsent();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders sparkle toggle and input in normal mode", () => {
    setup();
    expect(screen.getByTestId("sparkle-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByTestId("send-button")).toBeInTheDocument();
  });

  it("toggles AI mode on sparkle button click", async () => {
    const { user } = setup();
    const toggle = screen.getByTestId("sparkle-toggle");

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

  });

  it("toggles back to normal mode on second sparkle click", async () => {
    const { user } = setup();
    const toggle = screen.getByTestId("sparkle-toggle");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSend when submitting in normal mode", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const { user } = setup({ onSend });

    await user.type(screen.getByTestId("chat-input"), "Olá");
    await user.click(screen.getByTestId("send-button"));

    expect(onSend).toHaveBeenCalledWith("Olá");
  });

  it("keeps the authored text when onSend rejects", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("send failed"));
    const { user } = setup({ onSend });

    await user.type(screen.getByTestId("chat-input"), "Olá");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Olá");
    });
    expect(screen.getByTestId("chat-input")).toHaveValue("Olá");
  });

  it("calls parse API when submitting in AI mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25 eu paguei");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/parse",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("shows parsing skeleton while loading", async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    expect(screen.getByTestId("parsing-skeleton")).toBeInTheDocument();

    resolve({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    await waitFor(() => {
      expect(screen.queryByTestId("parsing-skeleton")).not.toBeInTheDocument();
    });
  });

  it("shows draft card after successful parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-draft-card")).toBeInTheDocument();
    });

    expect(screen.getByTestId("draft-title")).toHaveTextContent("Uber");
  });

  it("calls onConfirmDraft when confirm button clicked, awaits it, and clears the draft only on success", async () => {
    const onConfirmDraft = vi.fn().mockResolvedValue({ expenseId: "expense-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { user } = setup({ onConfirmDraft });

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-confirm-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("draft-confirm-button"));
    expect(onConfirmDraft).toHaveBeenCalledWith(mockResult);

    // Committed: the draft card clears.
    await waitFor(() => {
      expect(screen.queryByTestId("chat-draft-card")).not.toBeInTheDocument();
    });
  });

  it("retains the reviewed draft and shows the error inline when confirmation is rejected", async () => {
    const onConfirmDraft = vi.fn().mockResolvedValue({ error: "Muitas requisições." });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { user } = setup({ onConfirmDraft });

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-confirm-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("draft-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-error")).toHaveTextContent("Muitas requisições.");
    });

    // Rejected: the reviewed draft card stays visible (not silently reset).
    expect(screen.getByTestId("chat-draft-card")).toBeInTheDocument();
    expect(screen.getByTestId("draft-title")).toHaveTextContent("Uber");
  });

  it("disables the confirm button while a confirmation is in flight (blocks duplicate submits)", async () => {
    let resolveConfirm: (value: { expenseId: string }) => void = () => {};
    const onConfirmDraft = vi.fn(
      () => new Promise<{ expenseId: string }>((resolve) => { resolveConfirm = resolve; }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { user } = setup({ onConfirmDraft });

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-confirm-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("draft-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-confirm-button")).toBeDisabled();
    });
    expect(onConfirmDraft).toHaveBeenCalledTimes(1);

    resolveConfirm({ expenseId: "expense-1" });
    await waitFor(() => {
      expect(screen.queryByTestId("chat-draft-card")).not.toBeInTheDocument();
    });
  });

  it("calls onEditDraft when edit button clicked", async () => {
    const onEditDraft = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );

    const { user } = setup({ onEditDraft });

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-edit-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("draft-edit-button"));
    expect(onEditDraft).toHaveBeenCalledWith(mockResult);
  });

  it("shows error state when parse fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Erro ao processar mensagem" }),
      }),
    );

    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "xyz");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("parse-error")).toBeInTheDocument();
    });
  });

  it("send button disabled when input is empty", () => {
    setup();
    expect(screen.getByTestId("send-button")).toBeDisabled();
  });

  it("pressing Enter submits in normal mode", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const { user } = setup({ onSend });

    await user.type(screen.getByTestId("chat-input"), "Oi{Enter}");
    expect(onSend).toHaveBeenCalledWith("Oi");
  });

  it("sends the characters an IME still holds in marked text", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const { user } = setup({ onSend });

    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    await user.type(input, "Ol");
    fireEvent.compositionStart(input);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Ola");
    fireEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("Ola");
    });
  });

  it("an Enter that confirms an IME candidate does not send", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const { user } = setup({ onSend });

    const input = screen.getByTestId("chat-input");
    await user.type(input, "ni hao");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("send acknowledgement", () => {
  it("keeps the text until the send is acknowledged, then clears it", async () => {
    const gate = Promise.withResolvers<{ ok: true }>();
    const onSend = vi.fn().mockReturnValue(gate.promise);
    const { user } = setup({ onSend });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    await user.type(input, "Oi");
    await user.click(screen.getByTestId("send-button"));

    // Still in flight: discarding the text now would lose it on failure.
    expect(input.value).toBe("Oi");

    gate.resolve({ ok: true });
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("preserves the exact text and shows a retry when the send fails", async () => {
    const onSend = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Sem conexão." });
    const { user } = setup({ onSend });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    await user.type(input, "  Oi  tudo bem");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("send-error")).toBeInTheDocument();
    });
    // Whitespace the user typed is untouched, so retrying sends the same thing.
    expect(input.value).toBe("  Oi  tudo bem");
    expect(onSend).toHaveBeenCalledWith("Oi  tudo bem");
  });

  it("locks out a second submit while the first is in flight", async () => {
    const gate = Promise.withResolvers<{ ok: true }>();
    const onSend = vi.fn().mockReturnValue(gate.promise);
    const { user } = setup({ onSend });

    await user.type(screen.getByTestId("chat-input"), "Oi");
    await user.click(screen.getByTestId("send-button"));
    await user.click(screen.getByTestId("send-button"));

    expect(onSend).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    await waitFor(() => {
      expect((screen.getByTestId("chat-input") as HTMLInputElement).value).toBe("");
    });
  });

  it("does not overwrite newer text typed while the send was in flight", async () => {
    const gate = Promise.withResolvers<{ ok: true }>();
    const onSend = vi.fn().mockReturnValue(gate.promise);
    const { user } = setup({ onSend });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    await user.type(input, "primeira");
    await user.click(screen.getByTestId("send-button"));
    await user.type(input, " e segunda");

    gate.resolve({ ok: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    // The success belongs to an older edit generation, so it must not clear
    // what the user has typed since.
    expect(input.value).toBe("primeira e segunda");
  });

  it("clears the sent text when the IME commits it after the send", async () => {
    const gate = Promise.withResolvers<{ ok: true }>();
    const onSend = vi.fn().mockReturnValue(gate.promise);
    const { user } = setup({ onSend });

    const input = screen.getByTestId<HTMLInputElement>("chat-input");
    await user.type(input, "Ol");
    fireEvent.compositionStart(input);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Ola");
    fireEvent.click(screen.getByTestId("send-button"));
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "Ola" } });

    gate.resolve({ ok: true });
    await waitFor(() => expect(input.value).toBe(""));
    expect(onSend).toHaveBeenCalledWith("Ola");
  });

  it("treats a thrown send as failure and keeps the text", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("boom"));
    const { user } = setup({ onSend });

    const input = screen.getByTestId("chat-input") as HTMLInputElement;
    await user.type(input, "Oi{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("send-error")).toBeInTheDocument();
    });
    expect(input.value).toBe("Oi");
  });

});

describe("ChatAiInput AI consent", () => {
  beforeEach(() => {
    seedUsableAiConsent();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("declining AI keeps typed text and normal send available", async () => {
    useAppStore.getState().reset();
    useAppStore.setState({
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: "user-1",
      me: makeMe("user-1", false),
    });
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { user } = setup({ onSend });

    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("sparkle-toggle"));

    expect(screen.getByText("Usar IA no Dividimos?")).toBeInTheDocument();
    expect(screen.getByTestId("sparkle-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continuar sem IA" }));

    expect(screen.queryByText("Usar IA no Dividimos?")).toBeNull();
    expect(screen.getByTestId("chat-input")).toHaveValue("uber 25");

    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("uber 25");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 403 preserves typed text without automatic resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
          code: "ai_consent_required",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25 eu paguei");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      expect(screen.getByTestId("parse-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("parse-error")).toHaveTextContent(
      "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
    );
    expect(screen.getByTestId("chat-input")).toHaveValue("uber 25 eu paguei");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chat-draft-card")).toBeNull();
  });

  it("revocation or account switch discards a late parse result", async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { user } = setup();

    await user.click(screen.getByTestId("sparkle-toggle"));
    await user.type(screen.getByTestId("chat-input"), "uber 25");
    await user.click(screen.getByTestId("send-button"));
    expect(screen.getByTestId("parsing-skeleton")).toBeInTheDocument();

    // The shared device now belongs to another account while the parse is in
    // flight; its result must never surface.
    act(() => {
      useAppStore.setState({
        me: makeMe("user-2", false),
        lastBootstrappedAccountId: "user-2",
        aiConsentRevision: useAppStore.getState().aiConsentRevision + 1,
      });
    });
    resolve({ ok: true, json: () => Promise.resolve(mockResult) });

    await waitFor(() => {
      expect(screen.queryByTestId("parsing-skeleton")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("chat-draft-card")).toBeNull();
    expect(screen.queryByTestId("parse-error")).toBeNull();
  });
});
