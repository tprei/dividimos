import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LedgerError } from "@/lib/sync/errors";
import type { ReportInput, ReportResult } from "@/lib/reports";
import { ReportContentAction } from "./report-content-action";

const reportContent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sync/reports", () => ({ reportContent: reportContent }));

const subject = { id: "target-1", name: "Bruno", handle: "bruno", avatarUrl: null };
const success: ReportResult = {
  reportId: "6f1a2b3c-4d5e-4f60-8a71-9b0c1d2e3f40",
  delivered: true,
};

function deferred(): {
  promise: Promise<ReportResult>;
  resolve: (result: ReportResult) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (result: ReportResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ReportResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openProfileDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Denunciar pessoa" }));
  expect(await screen.findByRole("radio", { name: "Assédio ou perseguição" })).toBeInTheDocument();
}

async function openMessageDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Opções da mensagem" }));
  await user.click(await screen.findByRole("button", { name: "Denunciar mensagem" }));
  expect(await screen.findByRole("radio", { name: "Assédio ou perseguição" })).toBeInTheDocument();
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  details: string,
): Promise<void> {
  if (details.length > 0) {
    await user.type(screen.getByLabelText("Detalhes (opcional)"), details);
  }
  await user.click(screen.getByRole("radio", { name: "Outro motivo" }));
  await user.click(screen.getByRole("button", { name: "Enviar denúncia" }));
}

describe("ReportContentAction", () => {
  beforeEach(() => {
    reportContent.mockReset();
    reportContent.mockResolvedValue(success);
  });

  it("requires a reason before submission and allows optional details", async () => {
    const user = userEvent.setup();
    render(
      <ReportContentAction
        subject={subject}
        messageId={null}
        messagePreview={null}
        presentation="profile"
      />,
    );
    await openProfileDialog(user);

    const submit = screen.getByRole("button", { name: "Enviar denúncia" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Detalhes (opcional)"), "explico aqui");
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Assédio ou perseguição" }));
    expect(submit).toBeEnabled();

    await user.click(submit);
    await waitFor(() => {
      expect(screen.getByText("Denúncia enviada")).toBeInTheDocument();
    });
    expect(reportContent).toHaveBeenCalledWith({
      targetUserId: "target-1",
      messageId: null,
      reason: "assedio",
      details: "explico aqui",
    });
  });

  it("does not show success while delivery is pending or failed", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reportContent.mockReturnValue(pending.promise);
    render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview="texto da mensagem"
        presentation="profile"
      />,
    );
    await openProfileDialog(user);
    await fillAndSubmit(user, "");

    expect(screen.getByRole("button", { name: "Enviando…" })).toBeInTheDocument();
    expect(screen.queryByText("Denúncia enviada")).not.toBeInTheDocument();
    expect(screen.queryByText(/Protocolo:/)).not.toBeInTheDocument();

    pending.reject(new LedgerError("report_delivery_failed"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "A denúncia foi salva, mas ainda não chegou à equipe. Tente enviar de novo.",
    );
    expect(screen.queryByText("Denúncia enviada")).not.toBeInTheDocument();
    expect(screen.queryByText(/Protocolo:/)).not.toBeInTheDocument();
  });

  it("retries the frozen report and shows success only after acceptance", async () => {
    const user = userEvent.setup();
    const first = deferred();
    reportContent.mockReturnValueOnce(first.promise);
    render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview={null}
        presentation="profile"
      />,
    );
    await openProfileDialog(user);
    await fillAndSubmit(user, "primeira tentativa");

    first.reject(new LedgerError("report_delivery_failed"));
    await screen.findByRole("alert");

    const expected: ReportInput = {
      targetUserId: "target-1",
      messageId: "m-1",
      reason: "outro",
      details: "primeira tentativa",
    };
    expect(reportContent).toHaveBeenCalledWith(expected);
    expect(screen.getByRole("radio", { name: "Outro motivo" })).toBeDisabled();
    expect(screen.getByLabelText("Detalhes (opcional)")).toBeDisabled();
    expect(screen.getByText("Ao tentar de novo, vamos reenviar a mesma denúncia.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar enviar de novo" }));
    await waitFor(() => {
      expect(reportContent).toHaveBeenCalledTimes(2);
    });
    expect(reportContent).toHaveBeenLastCalledWith(expected);

    await screen.findByText("Denúncia enviada");
    expect(screen.getByText(/Protocolo:/)).toHaveTextContent(success.reportId);
  });

  it("prevents duplicate submissions and dismissal during an in-flight request", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reportContent.mockReturnValue(pending.promise);
    render(
      <ReportContentAction
        subject={subject}
        messageId={null}
        messagePreview={null}
        presentation="profile"
      />,
    );
    await openProfileDialog(user);
    await user.click(screen.getByRole("radio", { name: "Assédio ou perseguição" }));

    const submit = screen.getByRole("button", { name: "Enviar denúncia" });
    submit.click();
    submit.click();
    expect(reportContent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeInTheDocument();
    expect(screen.getByLabelText("Detalhes (opcional)")).toBeDisabled();

    pending.resolve(success);
    await screen.findByText("Denúncia enviada");
  });

  it("opens reporting from the message menu and restores focus on close", async () => {
    const user = userEvent.setup();
    render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview="texto da mensagem"
        presentation="message-menu"
      />,
    );

    await openMessageDialog(user);
    expect(screen.getByText("Mensagem selecionada")).toBeInTheDocument();
    expect(screen.getByText("texto da mensagem")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByText("Denunciar mensagem")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Opções da mensagem" }),
    );
  });

  it("keeps an open dialog mounted when the message is erased mid-flow", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reportContent.mockReturnValue(pending.promise);
    const { rerender } = render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview="texto da mensagem"
        presentation="message-menu"
        messageErased={false}
      />,
    );
    await openMessageDialog(user);
    await user.click(screen.getByRole("radio", { name: "Golpe ou spam" }));

    rerender(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview={null}
        presentation="message-menu"
        messageErased
      />,
    );
    expect(screen.queryByRole("button", { name: "Opções da mensagem" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Golpe ou spam" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enviar denúncia" }));
    pending.resolve(success);
    await screen.findByText("Denúncia enviada");
  });

  it("treats terminal errors as editable without the frozen retry copy", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reportContent.mockReturnValueOnce(pending.promise);
    render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview="texto"
        presentation="profile"
      />,
    );
    await openProfileDialog(user);
    await fillAndSubmit(user, "detalhes inválidos");

    pending.reject(new LedgerError("message_not_found"));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Essa mensagem não está mais disponível.");
    expect(
      screen.queryByText("Ao tentar de novo, vamos reenviar a mesma denúncia."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Outro motivo" })).toBeEnabled();
    expect(screen.getByLabelText("Detalhes (opcional)")).toBeEnabled();

    await user.clear(screen.getByLabelText("Detalhes (opcional)"));
    await user.type(screen.getByLabelText("Detalhes (opcional)"), "detalhes corrigidos");
    await user.click(screen.getByRole("button", { name: "Enviar denúncia" }));
    await screen.findByText("Denúncia enviada");
    expect(reportContent).toHaveBeenLastCalledWith({
      targetUserId: "target-1",
      messageId: "m-1",
      reason: "outro",
      details: "detalhes corrigidos",
    });
  });

  it("keeps the frozen input across cancel and reopen until it resolves", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    reportContent.mockReturnValueOnce(pending.promise);
    render(
      <ReportContentAction
        subject={subject}
        messageId="m-1"
        messagePreview={null}
        presentation="profile"
      />,
    );
    await openProfileDialog(user);
    await fillAndSubmit(user, "primeira tentativa salva");
    pending.reject(new LedgerError("report_delivery_failed"));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: "Outro motivo" })).not.toBeInTheDocument();
    });
    await openProfileDialog(user);
    expect(screen.getByRole("button", { name: "Enviar denúncia" })).toBeInTheDocument();
    const restored = screen.getByLabelText("Detalhes (opcional)");
    expect(restored).toBeDisabled();
    expect(restored).toHaveValue("primeira tentativa salva");
    expect(screen.getByRole("radio", { name: "Outro motivo" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Enviar denúncia" }));
    await waitFor(() => {
      expect(reportContent).toHaveBeenCalledTimes(2);
    });
    expect(reportContent).toHaveBeenLastCalledWith({
      targetUserId: "target-1",
      messageId: "m-1",
      reason: "outro",
      details: "primeira tentativa salva",
    });
    await screen.findByText("Denúncia enviada");
  });
});
