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
import { processReceiptScan } from "@/lib/process-receipt-scan";
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
    receiptAccessKey: string | null,
    divisions: Record<number, ItemDivisionValue>,
    occurredOn: string,
  ) => void;
  onVoiceConfirm: (result: VoiceExpenseResult, resolvedParticipants: ResolvedParticipant[]) => void;
  onReviewingChange: (reviewing: boolean) => void;
  onManageParticipants: () => void;
}

interface ScanAttempt {
  accountId: string | null;
  accountEpoch: number;
  controller: AbortController;
}


export function TypeStep({
  groupMembers,
  occurredOn,
  participants,
  accountId,
  onTypeSelect,
  onScanConfirm,
  onVoiceConfirm,
  onReviewingChange,
  onManageParticipants,
}: TypeStepProps) {
  const searchParams = useSearchParams();

  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptOcrResult | null>(null);
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceExpenseResult | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const attemptRef = useRef<ScanAttempt | null>(null);
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

  const isCurrentAttempt = useCallback((attempt: ScanAttempt): boolean => {
    return (
      attemptRef.current === attempt &&
      attempt.accountId === accountRef.current &&
      attempt.accountEpoch === accountEpochRef.current &&
      !attempt.controller.signal.aborted
    );
  }, []);


  const invalidateAttempt = useCallback(() => {
    const attempt = attemptRef.current;
    attemptRef.current = null;
    attempt?.controller.abort();
  }, []);

  const resetScanState = useCallback(() => {
    invalidateAttempt();
    setScanResult(null);
    setScanProcessing(false);
    setScanProcessingPhoto(false);
    setScanError(null);
  }, [invalidateAttempt]);

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
    if (searchParams.get("scan") && !showScanner && !scanResult) {
      scanParamRef.current = true;
      setShowScanner(true);
    }
  }, [searchParams, showScanner, scanResult]);

  const openScanner = useCallback(() => {
    setShowScanner(true);
  }, []);

  const reviewing = scanResult !== null;
  useEffect(() => {
    onReviewingChange(reviewing);
    return () => onReviewingChange(false);
  }, [reviewing, onReviewingChange]);

  const handleScanProcess = useCallback(async (file: File) => {
    const previous = attemptRef.current;
    previous?.controller.abort();
    const attempt: ScanAttempt = {
      accountId: accountRef.current,
      accountEpoch: accountEpochRef.current,
      controller: new AbortController(),
    };
    attemptRef.current = attempt;
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    setScanError(null);
    try {
      const result = await processReceiptScan(file, attempt.controller.signal);
      if (!isCurrentAttempt(attempt)) return;
      setScanResult(result);
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
  }, [isCurrentAttempt, resetScanState]);


  const handleScanConfirm = useCallback((result: ReceiptOcrResult, occurredOn: string) => {
    setScanResult(null);
    onScanConfirm(result, null, {}, occurredOn);
  }, [onScanConfirm]);

  const handleScanCancel = useCallback(() => {
    setScanResult(null);
  }, []);

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

  if (scanResult) {
    return (
      <ScannedItemsReview
        result={scanResult}
        participants={participants}
        initialOccurredOn={occurredOn}
        onConfirm={handleScanConfirm}
        onCancel={handleScanCancel}
        onManageParticipants={onManageParticipants}
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
          onProcess={handleScanProcess}
          onBack={() => {
            resetScanState();
            setShowScanner(false);
          }}
          processing={scanProcessing}
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
      onScanReceipt={openScanner}
      onVoiceExpense={() => setShowVoiceInput(true)}
    />
  );
}
