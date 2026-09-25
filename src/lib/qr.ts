/**
 * QR painting behind a dynamic import on purpose: `qrcode` is a heavy lib
 * and the plan keeps it loading on demand, so a static import here would
 * pull it into every bundle that renders a share surface.
 */
export interface QrOptions {
  width: number;
  margin: number;
  color?: { dark: string; light: string };
}

export async function qrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options: QrOptions,
): Promise<void> {
  const QRCode = await import("qrcode");
  await QRCode.toCanvas(canvas, text, options);
}
