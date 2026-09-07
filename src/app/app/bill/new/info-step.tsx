"use client";

import { motion } from "framer-motion";
import { Camera, ScanLine } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ReceiptScanner } from "@/components/bill/receipt-scanner";
import { ScannedItemsReview } from "@/components/bill/scanned-items-review";
import { ScanSkeletonLoader } from "@/components/bill/scan-skeleton-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NfceQrResult } from "@/lib/nfce-qr";
import { checkDuplicateReceipt, markReceiptScanned } from "@/lib/nfce-dedup";
import { processReceiptScan, fetchSefazReceipt, SefazFallbackError } from "@/lib/process-receipt-scan";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { ExpenseType } from "@/types";

export interface InfoStepProps {
  billType: ExpenseType;
  title: string;
  onTitleChange: (title: string) => void;
  occurredOn: string;
  onOccurredOnChange: (date: string) => void;
  merchantName: string;
  onMerchantNameChange: (merchant: string) => void;
  serviceFee: string;
  onServiceFeeChange: (fee: string) => void;
  fixedFees: string;
  onFixedFeesChange: (fees: string) => void;
  onScanConfirm: (result: ReceiptOcrResult) => void;
}

const SINGLE_SUGGESTIONS = ["Airbnb", "Uber", "Presente", "Mercado", "Aluguel"] as const;
const ITEMIZED_SUGGESTIONS = ["Bar", "Restaurante", "Churrasco", "Pizza", "Lanchonete"] as const;

export function InfoStep({
  billType,
  title,
  onTitleChange,
  occurredOn,
  onOccurredOnChange,
  merchantName,
  onMerchantNameChange,
  serviceFee,
  onServiceFeeChange,
  fixedFees,
  onFixedFeesChange,
  onScanConfirm,
}: InfoStepProps) {
  const [showScanner, setShowScanner] = useState(false);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingPhoto, setScanProcessingPhoto] = useState(false);
  const [pageScanResult, setPageScanResult] = useState<ReceiptOcrResult | null>(null);
  const lastPageQrResultRef = useRef<NfceQrResult | null>(null);

  const handleScanProcess = useCallback(async (file: File) => {
    setScanProcessing(true);
    setScanProcessingPhoto(true);
    try {
      const result: ReceiptOcrResult = await processReceiptScan(file);
      setShowScanner(false);
      setPageScanResult(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar imagem");
    } finally {
      setScanProcessing(false);
      setScanProcessingPhoto(false);
    }
  }, []);

  const handlePageScanReviewConfirm = useCallback((result: ReceiptOcrResult) => {
    const chaveAcesso = lastPageQrResultRef.current?.chaveAcesso ?? null;
    if (chaveAcesso) {
      markReceiptScanned(chaveAcesso);
      lastPageQrResultRef.current = null;
    }
    setPageScanResult(null);
    onScanConfirm(result);
  }, [onScanConfirm]);

  const handlePageScanReviewCancel = useCallback(() => {
    lastPageQrResultRef.current = null;
    setPageScanResult(null);
  }, []);

  const handlePageQrDetected = useCallback(async (result: NfceQrResult) => {
    setScanProcessing(true);
    lastPageQrResultRef.current = result;

    const previousScan = checkDuplicateReceipt(result.chaveAcesso);
    if (previousScan) {
      const date = new Date(previousScan);
      const formatted = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.error(`Esta nota já foi escaneada em ${formatted}.`);
      setScanProcessing(false);
      return;
    }

    try {
      const receipt = await fetchSefazReceipt(result.url);
      setShowScanner(false);
      setPageScanResult(receipt);
    } catch (err) {
      if (err instanceof SefazFallbackError) {
        toast.error("Não foi possível ler a nota online. Tente capturar a foto.");
      } else {
        toast.error(err instanceof Error ? err.message : "Erro ao consultar SEFAZ");
      }
    } finally {
      setScanProcessing(false);
    }
  }, []);

  if (pageScanResult) {
    return (
      <motion.div
        key="info-scan-review"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
      >
        <ScannedItemsReview
          result={pageScanResult}
          onConfirm={handlePageScanReviewConfirm}
          onCancel={handlePageScanReviewCancel}
        />
      </motion.div>
    );
  }

  if (scanProcessingPhoto) {
    return (
      <motion.div
        key="info-scan-skeleton"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
      >
        <ScanSkeletonLoader />
      </motion.div>
    );
  }

  if (showScanner) {
    return (
      <motion.div
        key="info-scanner"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
        className="space-y-3"
      >
        <ReceiptScanner
          onProcess={handleScanProcess}
          onQrDetected={handlePageQrDetected}
          onBack={() => setShowScanner(false)}
          processing={scanProcessing}
        />
      </motion.div>
    );
  }

  const suggestions = billType === "single_amount" ? SINGLE_SUGGESTIONS : ITEMIZED_SUGGESTIONS;

  return (
    <motion.div
      key="info"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium">Nome da conta</label>
        <Input
          placeholder={
            billType === "single_amount"
              ? "Ex: Airbnb, Uber, presente..."
              : "Ex: Churrascaria, Bar do Zeca..."
          }
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
              onClick={() => onTitleChange(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Data</label>
        <Input
          type="date"
          value={occurredOn}
          onChange={(e) => onOccurredOnChange(e.target.value)}
        />
      </div>

      {billType === "itemized" && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Estabelecimento (opcional)
            </label>
            <Input
              placeholder="Nome do restaurante"
              value={merchantName}
              onChange={(e) => onMerchantNameChange(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Taxa de serviço (%)
              </label>
              <Input
                type="number"
                min="0"
                max="100"
                value={serviceFee}
                onChange={(e) => onServiceFeeChange(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Couvert / taxas fixas (R$)
              </label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={fixedFees}
                onChange={(e) => onFixedFeesChange(e.target.value)}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">Escanear nota fiscal</p>
                <p className="text-xs text-muted-foreground">
                  QR Code NFC-e ou foto do cupom
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="mt-3 w-full gap-2"
              onClick={() => setShowScanner(true)}
            >
              <ScanLine className="h-4 w-4" />
              Escanear
            </Button>
          </div>
        </>
      )}
    </motion.div>
  );
}
