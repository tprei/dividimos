import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SyncErrorState } from "./sync-error-state";

describe("SyncErrorState", () => {
  it("renders role alert and executes onRetry", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<SyncErrorState message="Falhou." onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Falhou.");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
