"use client";

import { useRef, useState } from "react";
import { Flag } from "lucide-react";
import type { UserProfile } from "@/types/ledger";
import type { ReportDialogState } from "@/components/reports/report-dialog";
import { ReportDialog } from "@/components/reports/report-dialog";
import { ReportActionMenu } from "@/components/reports/report-action-menu";
import { reportContent } from "@/lib/sync/reports";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { Button } from "@/components/ui/button";
import type { ReportInput, ReportReason } from "@/lib/reports";

const RETRYABLE_CODES: Record<string, boolean> = {
  report_delivery_failed: true,
  report_rate_limited: true,
  report_rate_limit_unavailable: true,
  network: true,
  invalid_wire: true,
};

export interface ReportContentActionProps {
  subject: Pick<UserProfile, "id" | "name" | "handle" | "avatarUrl">;
  messageId: string | null;
  messagePreview: string | null;
  presentation: "message-menu" | "profile";
  messageErased?: boolean;
}

export function ReportContentAction({ subject, messageId, messagePreview, presentation, messageErased = false }: ReportContentActionProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<ReportDialogState>({ status: "idle" });
  const [lockedInput, setLockedInput] = useState<ReportInput | null>(null);
  const [retryable, setRetryable] = useState(true);
  const inFlight = useRef(false);

  function openDialog(): void {
    const lock = lockedInput !== null &&
      lockedInput.targetUserId === subject.id &&
      lockedInput.messageId === messageId
      ? lockedInput
      : null;
    if (lock === null) setLockedInput(null);
    setReason(lock?.reason ?? "");
    setDetails(lock?.details ?? "");
    setState({ status: "idle" });
    setOpen(true);
  }

  function closeDialog(): void {
    if (state.status === "submitting") return;
    setOpen(false);
  }

  async function submit(): Promise<void> {
    if (inFlight.current || reason === "") return;
    const input: ReportInput = lockedInput ?? {
      targetUserId: subject.id,
      messageId,
      reason,
      details: details.trim() || null,
    };
    inFlight.current = true;
    setLockedInput(input);
    setRetryable(true);
    setState({ status: "submitting" });
    try {
      const result = await reportContent(input);
      setLockedInput(null);
      setState({ status: "success", reportId: result.reportId });
    } catch (error) {
      const retryableError = error instanceof LedgerError && RETRYABLE_CODES[error.code] === true;
      if (!retryableError) setLockedInput(null);
      setRetryable(retryableError);
      setState({ status: "error", message: ledgerErrorMessage(error) });
    } finally {
      inFlight.current = false;
    }
  }

  const showMenuTrigger = presentation === "profile" || !messageErased;

  return (
    <>
      {presentation === "message-menu" ? (
        showMenuTrigger ? (
          <ReportActionMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onReport={openDialog}
          />
        ) : null
      ) : (
        <Button variant="outline" size="lg" className="min-h-11 w-full" onClick={openDialog}>
          <Flag aria-hidden="true" />
          Denunciar pessoa
        </Button>
      )}
      <ReportDialog
        open={open}
        subject={subject}
        kind={messageId === null ? "user" : "message"}
        messagePreview={messagePreview}
        reason={reason}
        details={details}
        frozen={lockedInput !== null && retryable}
        state={state}
        errorKind={retryable ? "retryable" : "terminal"}
        onReasonChange={setReason}
        onDetailsChange={setDetails}
        onSubmit={() => void submit()}
        onClose={closeDialog}
      />
    </>
  );
}
