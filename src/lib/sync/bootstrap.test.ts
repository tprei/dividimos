import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "./errors";
import { rpc } from "./client";
import { attachVisibilityRefresh } from "./bootstrap";

vi.mock("./client", () => ({ rpc: vi.fn() }));

const rpcMock = vi.mocked(rpc);

function becomeVisible(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("attachVisibilityRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ lastBootstrapAt: null });
  });

  it("hands a failed refresh to the caller instead of leaking the rejection", async () => {
    const failure = new LedgerError("invalid_wire");
    rpcMock.mockRejectedValue(failure);
    const onError = vi.fn();

    const stop = attachVisibilityRefresh(onError);
    becomeVisible();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));

    stop();
  });

  it("stops refreshing once detached", () => {
    rpcMock.mockRejectedValue(new LedgerError("invalid_wire"));

    attachVisibilityRefresh(vi.fn())();
    becomeVisible();

    expect(rpcMock).not.toHaveBeenCalled();
  });
});
