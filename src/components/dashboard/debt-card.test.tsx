import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DebtSummary } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, ...rest } = props;
    void fill;
    return <img alt="" {...rest} />;
  },
}));

import { DebtCard } from "./debt-card";

const baseDebt: DebtSummary = {
  groupId: "group-1",
  groupName: "Apartamento",
  counterpartyId: "user-2",
  counterpartyName: "Maria Silva",
  counterpartyAvatarUrl: null,
  amountCents: 5000,
  direction: "owes",
};

describe("DebtCard", () => {
  const onPay = vi.fn();
  const onCollect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders counterparty name and group", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.getByText("Apartamento")).toBeInTheDocument();
  });

  it("renders formatted amount", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("shows 'Você deve' for owes direction", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    expect(screen.getByText("Você deve")).toBeInTheDocument();
  });

  it("shows 'Você recebe' for owed direction", () => {
    const owedDebt = { ...baseDebt, direction: "owed" as const };
    render(<DebtCard debt={owedDebt} onPay={onPay} onCollect={onCollect} />);
    expect(screen.getByText("Você recebe")).toBeInTheDocument();
  });

  it("navigates to conversation when card is clicked", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    const card = screen.getByRole("link");
    fireEvent.click(card);
    expect(mockPush).toHaveBeenCalledWith("/app/conversations/user-2");
  });

  it("navigates on Enter key press", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    const card = screen.getByRole("link");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/app/conversations/user-2");
  });

  it("navigates on Space key press", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    const card = screen.getByRole("link");
    fireEvent.keyDown(card, { key: " " });
    expect(mockPush).toHaveBeenCalledWith("/app/conversations/user-2");
  });

  it("calls onPay without navigating when Pay button is clicked", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />);
    fireEvent.click(screen.getByText("Pagar via Pix"));
    expect(onPay).toHaveBeenCalledWith(baseDebt);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("calls onCollect without navigating when Collect button is clicked", () => {
    const owedDebt = { ...baseDebt, direction: "owed" as const };
    render(<DebtCard debt={owedDebt} onPay={onPay} onCollect={onCollect} />);
    fireEvent.click(screen.getByText("Cobrar via Pix"));
    expect(onCollect).toHaveBeenCalledWith(owedDebt);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("disables button when isActing is true", () => {
    render(<DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} isActing />);
    expect(screen.getByText("Pagar via Pix")).toBeDisabled();
  });

  it("renders chevron icon for navigation affordance", () => {
    const { container } = render(
      <DebtCard debt={baseDebt} onPay={onPay} onCollect={onCollect} />,
    );
    const svg = container.querySelector("svg.lucide-chevron-right");
    expect(svg).toBeInTheDocument();
  });
});
