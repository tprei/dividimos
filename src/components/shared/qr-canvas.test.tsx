import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qrToCanvas } from "@/lib/qr";
import { QrCanvas } from "./qr-canvas";

vi.mock("@/lib/qr", () => ({
  qrToCanvas: vi.fn(),
}));

const options = { width: 200, margin: 2 };

describe("QrCanvas", () => {
  it("offers a retry when the code cannot be drawn and redraws on retry", async () => {
    const draw = vi.mocked(qrToCanvas);
    draw.mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(<QrCanvas value="00020126pix" label="QR Pix de R$ 10,00" options={options} />);

    const retry = await screen.findByRole("button", { name: "Tentar de novo" });
    expect(screen.queryByRole("img", { name: "QR Pix de R$ 10,00" })).toBeNull();

    await user.click(retry);

    expect(await screen.findByRole("img", { name: "QR Pix de R$ 10,00" })).toBeInTheDocument();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });
});