"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillTypeSelector } from "@/components/bill/bill-type-selector";
import { ReceiptScanner } from "@/components/bill/receipt-scanner";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { VoiceExpenseButton } from "@/components/bill/voice-expense-button";
import { VoiceExpenseModal, type ResolvedParticipant } from "@/components/bill/voice-expense-modal";
import { Button } from "@/components/ui/button";
import { useQrScannerPreload } from "@/hooks/use-qr-preload";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { NfceQrResult } from "@/lib/nfce-qr";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { ItemDivisionValue } from "@/lib/item-division";
import type { ItemDivisionParticipant } from "@/components/bill/item-division-editor";
import type { VoiceExpenseResult } from "@/lib/voice-expense-parser";
import type { ExpenseType, UserProfile } from "@/types";

export interface TypeStepProps {
  groupMembers: UserProfile[];
  participants: ItemDivisionParticipant[];
  occurredOn: string;
  /** Id of the signed-in account; a change invalidates any pending scan attempt. */
  accountId: string | null;
  onTypeSelect: (type: ExpenseType) => void;
  onScanConfirm: (
    result: ReceiptOcrResult,
    chaveAcesso: string | null,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => void;
  onVoiceConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
  onReviewingChange: (reviewing: boolean) => void;
}

/** One scan attempt (photo OCR or QR SEFAZ fetch) with its own abort scope. */
interface ScanAttempt {
  generation: number;
  source: "photo" | "qr";
  accountId: string | null;
  accountEpoch: number;
  controller: AbortController;
  result: ReceiptOcrResult | null;
  /** Access key of the scanned receipt; photo attempts always carry null. */
  receiptAccessKey: string | null;
}

/** Reviewed receipt awaiting confirmation, bound to the same object as its key. */
interface ReviewedAttempt {
  generation: number;
  result: ReceiptOcrResult;
  receiptAccessKey: string | null;
}

const QR_FALLBACK_MESSAGE = "Não foi possível ler a nota online. Tente capturar a foto.";

export function TypeStep({
  groupMembers,
  occurredOn,
  participants,
  accountId,
  onTypeSelect,
  onScanConfirm,
  onVoiceConfirm,
  onReviewingChange,
}: TypeStepProps) {
  const searchParams = useSearchParams();

  useQrScannerPreload();

  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewedAttempt | null>(null);
  const [scannerSession, setScannerSession] = useState(0);
  const [scannerTab, setScannerTab] = useState<"photo" | "qr">("photo");
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // The attempt lives in a ref so invalidation is synchronous; `review` only
  // mirrors what should render. Every async continuation must confirm the ref
  // still points at its own attempt and its controller was not aborted before
  // touching state.
  const attemptRef = useRef<ScanAttempt | null>(null);
  const generationRef = useRef(0);
  const reviewRef = useRef<ReviewedAttempt | null>(null);
  const accountRef = useRef(accountId);
  const accountEpochRef = useRef(0);
  const accountChanged = accountRef.current !== accountId;
  if (accountChanged) {
    accountRef.current = accountId;
    accountEpochRef.current += 1;
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.controller.abort();
  }
  const accountEpoch = accountEpochRef.current;

  const isCurrentAttempt = useCallback((attempt: ScanAttempt) => {
    return (
      attemptRef.current === attempt &&
      attempt.accountId === accountRef.current &&
      attempt.accountEpoch === accountEpochRef.current &&
      !attempt.controller.signal.aborted
    );
  }, []);


  const applyReview = useCallback((next: ReviewedAttempt | null) => {
    reviewRef.current = next;
    setReview(next);
  }, []);

  const invalidateAttempt = useCallback(() => {
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.controller.abort();
  }, []);

  const resetScanState = useCallback(() => {
    invalidateAttempt();
    applyReview(null);
    setScanProcessing(false);
    setScanProcessingPhoto(false);
    setScanError(null);
  }, [invalidateAttempt, applyReview]);

  // Unmount cleanup aborts any in-flight attempt without touching React state.
  useEffect(() => {
    return () => {
      const attempt = attemptRef.current;
      attemptRef.current = null;
      attempt?.controller.abort();
    };
  }, []);
  // Account changes invalidate synchronously during render so an old
  // continuation cannot win the interval before effects run.
  useLayoutEffect(() => {
    if (!accountChanged) return;
    resetScanState();
    setShowScanner(false);
  }, [accountChanged, resetScanState]);


  const scanParamRef = useRef(false);
  useEffect(() => {
    if (scanParamRef.current) return;
    if (searchParams.get("scan") && !showScanner && !review) {
      scanParamRef.current = true;
      setShowScanner(true);
    }
  }, [searchParams, showScanner, review]);

  const openScanner = useCallback((tab: "photo" | "qr" = "photo") => {
    setScannerTab(tab);
    setScannerSession((session) => session + 1);
    setShowScanner(true);
  }, []);

  const reviewing = review !== null;
  useEffect(() => {
    onReviewingChange(reviewing);
    return () => onReviewingChange(false);
  }, [reviewing, onReviewingChange]);

  const handleScanProcess = useCallback(async (file: File) => {
    if (accountRef.current !== accountId || accountEpochRef.current !== accountEpoch) return;
    invalidateAttempt();
    const controller = new AbortController();
    const attempt: ScanAttempt = {
      generation: ++generationRef.current,
      source: "photo",
      accountId,
      accountEpoch,
      controller,
      result: null,
      receiptAccessKey: null,
    };
    attemptRef.current = attempt;
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    setScanError(null);
    try {
      const result: ReceiptOcrResult = await processReceiptScan(file, controller.signal);
      if (!isCurrentAttempt(attempt)) return;
      attempt.result = result;
      applyReview({ generation: attempt.generation, result, receiptAccessKey: null });
      setShowScanner(false);
    } catch (err) {
      if (!isCurrentAttempt(attempt)) return;
      const message = err instanceof Error ? err.message : "Erro ao processar imagem";
      resetScanState();
      setScanError(message);
    } finally {
      if (isCurrentAttempt(attempt)) {
        setScanProcessing(false);
        setScanProcessingPhoto(false);
      }
    }
  }, [invalidateAttempt, applyReview, resetScanState, isCurrentAttempt, accountId, accountEpoch]);

  const handleQrDetected = useCallback(async (result: NfceQrResult) => {
    if (accountRef.current !== accountId || accountEpochRef.current !== accountEpoch) return;
    invalidateAttempt();
    const controller = new AbortController();
    const attempt: ScanAttempt = {
      generation: ++generationRef.current,
      source: "qr",
      accountId,
      accountEpoch,
      controller,
      result: null,
      receiptAccessKey: result.chaveAcesso,
    };
    attemptRef.current = attempt;
    setScanProcessing(true);
    setScanError(null);
    try {
      const receipt = await fetchSefazReceipt(result.url, result.chaveAcesso, controller.signal);
      if (!isCurrentAttempt(attempt)) return;
      attempt.result = receipt;
      applyReview({
        generation: attempt.generation,
        result: receipt,
        receiptAccessKey: attempt.receiptAccessKey,
      });
      setShowScanner(false);
    } catch (err) {
      if (!isCurrentAttempt(attempt)) return;
      const message =
        err instanceof Error ? err.message : "Erro ao consultar SEFAZ";
      resetScanState();
      setScanError(err instanceof SefazFallbackError ? QR_FALLBACK_MESSAGE : message);
      setScannerTab(err instanceof SefazFallbackError ? "photo" : "qr");
      // Remount the scanner so the QR camera is live again instead of staying
      // invisibly paused on the consumed result.
      setScannerSession((session) => session + 1);
    } finally {
      if (isCurrentAttempt(attempt)) {
        setScanProcessing(false);
      }
    }
  }, [invalidateAttempt, applyReview, resetScanState, isCurrentAttempt, accountId, accountEpoch]);

  const handleScanConfirm = useCallback((
    result: ReceiptOcrResult,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => {
    const attempt = attemptRef.current;
    const current = reviewRef.current;
    // Consume only the attempt currently under review; a stale or invalidated
    // attempt can never submit.
    if (
      !attempt ||
      !isCurrentAttempt(attempt) ||
      !current ||
      attempt.generation !== current.generation ||
      !attempt.result
    ) {
      return;
    }
    const receiptAccessKey = current.receiptAccessKey;
    resetScanState();
    onScanConfirm(result, receiptAccessKey, divisions, occurredOn);
  }, [resetScanState, onScanConfirm, isCurrentAttempt]);

  const handleScanCancel = useCallback(() => {
    resetScanState();
    setShowScanner(false);
  }, [resetScanState]);

  const handleScannerBack = useCallback(() => {
    resetScanState();
    setShowScanner(false);
  }, [resetScanState]);

  const handleSourceChange = useCallback(() => {
    resetScanState();
  }, [resetScanState]);

  const handleVoiceResult = useCallback((result: VoiceExpenseResult) => {
    setVoiceResult(result);
    setShowVoiceInput(false);
    setVoiceError(null);
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    setVoiceError(message);
  }, []);

  const handleVoiceCancel = useCallback(() => {
    setVoiceResult(null);
  }, []);

  if (review) {
    return (
      <ScannedItemsReview
        result={review.result}
        participants={participants}
        initialOccurredOn={occurredOn}
        onConfirm={handleScanConfirm}
        onCancel={handleScanCancel}
      />
    );
  }

  if (scanProcessingPhoto) {
    return <ScanSkeletonLoader />;
  }

  if (showScanner) {
    return (
      <div className="space-y-3">
        <ReceiptScanner
          key={scannerSession}
          defaultTab={scannerTab}
          onProcess={handleScanProcess}
          onBack={handleScannerBack}
          processing={scanProcessing}
          onQrDetected={handleQrDetected}
          onSourceChange={handleSourceChange}
        />
        {scanError && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-sm text-destructive"
          >
            {scanError}
          </motion.p>
        )}
      </div>
    );
  }

  if (voiceResult) {
    return (
      <VoiceExpenseModal
        result={voiceResult}
        groupMembers={groupMembers}
        onConfirm={onVoiceConfirm}
        onCancel={handleVoiceCancel}
      />
    );
  }

  if (showVoiceInput) {
    return (
      <div className="space-y-3">
        <VoiceExpenseButton
          members={groupMembers.map((m) => ({ handle: m.handle, name: m.name }))}
          onResult={handleVoiceResult}
          onError={handleVoiceError}
        />
        {voiceError && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-sm text-destructive"
          >
            {voiceError}
          </motion.p>
        )}
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => { setShowVoiceInput(false); setVoiceError(null); }}
        >
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <BillTypeSelector
      onSelect={onTypeSelect}
      onScanReceipt={() => openScanner("photo")}
      onVoiceExpense={() => setShowVoiceInput(true)}
    />
  );
}
