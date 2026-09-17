import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBillStore } from "@/stores/bill-store";
import { hasMeaningfulDraft } from "@/lib/bill-draft";
import { DraftResumeBanner } from "@/components/bill/wizard/draft-resume-banner";
import { DiscardDraftDialog } from "@/components/bill/wizard/discard-draft-dialog";
import { selectDraftForType } from "./use-wizard-init";
import {
  clearDraftIntent,
  readDraftIntent,
  writeDraftIntent,
} from "@/lib/draft-intent";
import type { User } from "@/types";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";

const me: User = {
  id: "user-me",
  email: "me@example.com",
  handle: "me",
  name: "Eu Mesmo",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const otherUser: User = {
  id: "user-other",
  email: "other@example.com",
  handle: "other",
  name: "Outro Usuário",
  pixKeyType: "email",
  pixKeyHint: "",
  onboarded: true,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("Draft resume and discard behaviors", () => {
  beforeEach(() => {
    localStorage.clear();
    useBillStore.getState().reset();
    useBillStore.setState({ currentUser: me });
  });

  it("renders resume banner with Money total when only payers and billSplits are edited, and keeps edits intact on continue", async () => {
    const store = useBillStore.getState();
    store.createExpense("", "single_amount");
    store.updateExpense({ totalAmountInput: 8900 });
    store.addParticipant(me);
    store.addParticipant(otherUser);
    store.splitBillEqually([me.id, otherUser.id]);
    store.setPayerFull(me.id);

    const liveState = useBillStore.getState();
    expect(hasMeaningfulDraft(liveState, me.id)).toBe(true);

    const onContinue = vi.fn();
    const onDiscardRequest = vi.fn();

    render(
      <DraftResumeBanner
        title={liveState.expense?.title || null}
        itemCount={liveState.items.length}
        totalCents={liveState.totalAmountInput}
        onContinue={onContinue}
        onDiscardRequest={onDiscardRequest}
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("R$ 89,00")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onContinue).toHaveBeenCalledOnce();

    const stateAfter = useBillStore.getState();
    expect(stateAfter.payers).toMatchObject([{ userId: me.id, amountCents: 8900 }]);
    expect(stateAfter.billSplits).toHaveLength(2);
    expect(stateAfter.totalAmountInput).toBe(8900);
  });

  it("prompts dialog on meaningful draft type switch, preserving draft on keep and resetting on discard", async () => {
    const store = useBillStore.getState();
    store.createExpense("Pizzaria", "itemized");
    store.addItem({
      description: "Pizza Calabresa",
      quantity: 1,
      unitPriceCents: 4500,
      totalPriceCents: 4500,
    });
    writeDraftIntent({ kind: "create", draftKey: store.draftKey });

    const preSwitchExpense = useBillStore.getState().expense;
    expect(hasMeaningfulDraft(useBillStore.getState(), me.id)).toBe(true);

    let dialogOpen = true;
    const handleKeep = vi.fn(() => {
      dialogOpen = false;
    });
    const handleDiscard = vi.fn(() => {
      clearDraftIntent();
      selectDraftForType(useBillStore.getState(), "single_amount", null);
      dialogOpen = false;
    });

    const { rerender } = render(
      <DiscardDraftDialog
        open={dialogOpen}
        draftTitle={preSwitchExpense?.title || "Nova conta"}
        itemCount={useBillStore.getState().items.length}
        totalCents={useBillStore.getState().getGrandTotal()}
        mode="type-switch"
        isItemized={true}
        onDiscard={handleDiscard}
        onKeep={handleKeep}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manter rascunho" }));
    expect(handleKeep).toHaveBeenCalledOnce();

    expect(useBillStore.getState().expense).toBe(preSwitchExpense);
    expect(useBillStore.getState().items).toHaveLength(1);
    expect(readDraftIntent()).not.toBeNull();

    dialogOpen = true;
    rerender(
      <DiscardDraftDialog
        open={dialogOpen}
        draftTitle={preSwitchExpense?.title || "Nova conta"}
        itemCount={useBillStore.getState().items.length}
        totalCents={useBillStore.getState().getGrandTotal()}
        mode="type-switch"
        isItemized={true}
        onDiscard={handleDiscard}
        onKeep={handleKeep}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(handleDiscard).toHaveBeenCalledOnce();

    const stateAfterDiscard = useBillStore.getState();
    expect(stateAfterDiscard.expense?.expenseType).toBe("single_amount");
    expect(stateAfterDiscard.items).toHaveLength(0);
    expect(readDraftIntent()).toBeNull();
  });

  it("prompts dialog on voice parse over meaningful draft, preserves draftKey on cancel, and hydrates on confirm", async () => {
    const store = useBillStore.getState();
    store.createExpense("Almoço Antigo", "single_amount");
    store.updateExpense({ totalAmountInput: 5000 });
    store.setOccurredOn("2026-09-10");

    const preVoiceDraftKey = useBillStore.getState().draftKey;
    const preOccurredOn = useBillStore.getState().occurredOn;
    expect(hasMeaningfulDraft(useBillStore.getState(), me.id)).toBe(true);

    let dialogOpen = true;
    const handleVoiceCancel = vi.fn(() => {
      dialogOpen = false;
    });

    const voiceResult: VoiceExpenseResult = {
      title: "Churrasco de Domingo",
      amountCents: 6000,
      expenseType: "itemized",
      items: [{ description: "Carne", quantity: 1, unitPriceCents: 6000, totalCents: 6000 }],
      participants: [],
      merchantName: null,
    };

    const handleVoiceConfirm = vi.fn(() => {
      store.hydrateFromVoice(voiceResult, "group-1");
      writeDraftIntent({ kind: "create", draftKey: store.draftKey });
      dialogOpen = false;
    });

    const { rerender } = render(
      <DiscardDraftDialog
        open={dialogOpen}
        draftTitle={store.expense?.title || "Nova conta"}
        itemCount={store.items.length}
        totalCents={store.totalAmountInput}
        mode="voice"
        onDiscard={handleVoiceConfirm}
        onKeep={handleVoiceCancel}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manter rascunho" }));
    expect(handleVoiceCancel).toHaveBeenCalledOnce();

    const stateAfterCancel = useBillStore.getState();
    expect(stateAfterCancel.draftKey).toBe(preVoiceDraftKey);
    expect(stateAfterCancel.occurredOn).toBe(preOccurredOn);
    expect(stateAfterCancel.expense?.title).toBe("Almoço Antigo");

    dialogOpen = true;
    rerender(
      <DiscardDraftDialog
        open={dialogOpen}
        draftTitle={store.expense?.title || "Nova conta"}
        itemCount={store.items.length}
        totalCents={store.totalAmountInput}
        mode="voice"
        onDiscard={handleVoiceConfirm}
        onKeep={handleVoiceCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(handleVoiceConfirm).toHaveBeenCalledOnce();

    const stateAfterConfirm = useBillStore.getState();
    expect(stateAfterConfirm.expense?.title).toBe("Churrasco de Domingo");
    expect(stateAfterConfirm.expense?.expenseType).toBe("itemized");
  });

  it("switches type silently without dialog when current draft is baseline and empty", () => {
    const store = useBillStore.getState();
    store.createExpense("Nova conta", "itemized");

    expect(hasMeaningfulDraft(store, me.id)).toBe(false);

    selectDraftForType(store, "single_amount", null);

    const stateAfter = useBillStore.getState();
    expect(stateAfter.expense?.expenseType).toBe("single_amount");
  });
});
