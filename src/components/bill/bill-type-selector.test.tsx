import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillTypeSelector } from "./bill-type-selector";
import { haptics } from "@/hooks/use-haptics";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BillTypeSelector", () => {
  it("renders both bill type options", () => {
    render(<BillTypeSelector onSelect={vi.fn()} />);

    expect(screen.getByText("Valor único")).toBeInTheDocument();
    expect(screen.getByText("Vários itens")).toBeInTheDocument();
  });

  it("shows heading and description", () => {
    render(<BillTypeSelector onSelect={vi.fn()} />);

    expect(screen.getByText("Que tipo de conta?")).toBeInTheDocument();
    expect(screen.getByText("Escolha como você quer rachar.")).toBeInTheDocument();
  });

  it("shows examples for each option", () => {
    render(<BillTypeSelector onSelect={vi.fn()} />);

    expect(screen.getByText(/Airbnb, Uber/)).toBeInTheDocument();
    expect(screen.getByText(/Restaurante, bar/)).toBeInTheDocument();
  });

  it("calls onSelect with 'single_amount' when first option clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BillTypeSelector onSelect={onSelect} />);

    // motion.button renders as <button>, find by text content
    const btn = screen.getByText("Valor único").closest("button");
    expect(btn).not.toBeNull();
    await user.click(btn!);
    expect(onSelect).toHaveBeenCalledWith("single_amount");
  });

  it("calls onSelect with 'itemized' when second option clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<BillTypeSelector onSelect={onSelect} />);

    const btn = screen.getByText("Vários itens").closest("button");
    expect(btn).not.toBeNull();
    await user.click(btn!);
    expect(onSelect).toHaveBeenCalledWith("itemized");
  });

  describe("scan receipt option", () => {
    it("does not render scan option when onScanReceipt is not provided", () => {
      render(<BillTypeSelector onSelect={vi.fn()} />);

      expect(screen.queryByText("Escanear nota")).not.toBeInTheDocument();
    });

    it("renders scan option when onScanReceipt is provided", () => {
      render(
        <BillTypeSelector onSelect={vi.fn()} onScanReceipt={vi.fn()} />,
      );

      expect(screen.getByText("Escanear nota")).toBeInTheDocument();
      expect(
        screen.getByText("Foto do cupom ou QR Code NFC-e"),
      ).toBeInTheDocument();
    });

    it("calls onScanReceipt when scan option is clicked", async () => {
      const onScanReceipt = vi.fn();
      const user = userEvent.setup();
      render(
        <BillTypeSelector onSelect={vi.fn()} onScanReceipt={onScanReceipt} />,
      );

      const btn = screen.getByText("Escanear nota").closest("button");
      expect(btn).not.toBeNull();
      await user.click(btn!);
      expect(onScanReceipt).toHaveBeenCalledOnce();
    });

    it("does not call onSelect when scan option is clicked", async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <BillTypeSelector onSelect={onSelect} onScanReceipt={vi.fn()} />,
      );

      const btn = screen.getByText("Escanear nota").closest("button");
      await user.click(btn!);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("haptics", () => {
    it("triggers haptics.tap on type selection", async () => {
      const user = userEvent.setup();
      render(<BillTypeSelector onSelect={vi.fn()} />);

      const btn = screen.getByText("Valor único").closest("button")!;
      await user.click(btn);
      expect(haptics.tap).toHaveBeenCalledOnce();
    });

    it("triggers haptics.tap on scan receipt click", async () => {
      const user = userEvent.setup();
      render(<BillTypeSelector onSelect={vi.fn()} onScanReceipt={vi.fn()} />);

      const btn = screen.getByText("Escanear nota").closest("button")!;
      await user.click(btn);
      expect(haptics.tap).toHaveBeenCalledOnce();
    });
  });

  describe("voice expense option", () => {
    it("does not render voice option when onVoiceExpense is not provided", () => {
      render(<BillTypeSelector onSelect={vi.fn()} />);
      expect(screen.queryByText("Falar despesa")).not.toBeInTheDocument();
    });

    it("renders voice option when onVoiceExpense is provided", () => {
      render(
        <BillTypeSelector onSelect={vi.fn()} onVoiceExpense={vi.fn()} />,
      );
      expect(screen.getByText("Falar despesa")).toBeInTheDocument();
      expect(screen.getByText("Diga o que gastou e com quem")).toBeInTheDocument();
    });

    it("calls onVoiceExpense when voice option is clicked", async () => {
      const onVoiceExpense = vi.fn();
      const user = userEvent.setup();
      render(
        <BillTypeSelector onSelect={vi.fn()} onVoiceExpense={onVoiceExpense} />,
      );
      const btn = screen.getByText("Falar despesa").closest("button");
      expect(btn).not.toBeNull();
      await user.click(btn!);
      expect(onVoiceExpense).toHaveBeenCalledOnce();
    });

    it("does not call onSelect when voice option is clicked", async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <BillTypeSelector onSelect={onSelect} onVoiceExpense={vi.fn()} />,
      );
      const btn = screen.getByText("Falar despesa").closest("button");
      await user.click(btn!);
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
