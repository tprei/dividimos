"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { qrToCanvas, type QrOptions } from "@/lib/qr";

export interface QrCanvasProps {
  value: string;
  label: string;
  options: QrOptions;
  className?: string;
}

/**
 * Paints a QR code and keeps the failure visible. `qrcode` loads on demand,
 * so an offline first open can fail; a blank paper box would read as a
 * broken payment, so the user gets a retry instead.
 */
export function QrCanvas({ value, label, options, className }: QrCanvasProps) {
  const [failedValue, setFailedValue] = useState<string | null>(null);
  const { width, margin, color } = options;
  const dark = color?.dark;
  const light = color?.light;

  const paint = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (!node) return;
      const qrColor = dark && light ? { dark, light } : undefined;
      void qrToCanvas(node, value, { width, margin, color: qrColor }).then(
        () => {
          // The library pins the drawn size inline, which would outrank the
          // classes that shrink the code on short screens.
          node.style.removeProperty("width");
          node.style.removeProperty("height");
          setFailedValue(null);
        },
        () => setFailedValue(value),
      );
    },
    [value, width, margin, dark, light],
  );

  if (failedValue === value) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 p-2 text-center text-sm text-muted-foreground">
        <p>O QR code não carregou.</p>
        <Button variant="outline" size="sm" onClick={() => setFailedValue(null)}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return <canvas ref={paint} role="img" aria-label={label} className={className} />;
}