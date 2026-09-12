import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const { initCapacitor, registerServiceWorker } = vi.hoisted(() => ({
  initCapacitor: vi.fn(),
  registerServiceWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/capacitor", () => ({ initCapacitor }));
vi.mock("@/lib/push/service-worker", () => ({ registerServiceWorker }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { RegisterSW } from "./register-sw";

/** Order of operations, so "unregistered before Capacitor started" is checkable. */
let order: string[] = [];

function installServiceWorkerMock(options: {
  unregister?: () => Promise<boolean>;
  controlledAfter?: boolean;
}) {
  const unregister =
    options.unregister ??
    (async () => {
      order.push("unregister");
      return true;
    });

  const controller = { scriptURL: "/sw.js" };
  const serviceWorker = {
    getRegistrations: async () => [{ unregister }],
    get controller() {
      return options.controlledAfter ? controller : null;
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: serviceWorker,
    configurable: true,
  });
}

function makeNative() {
  (window as unknown as Record<string, unknown>).androidBridge = {};
}

describe("RegisterSW on a native install", () => {
  const reload = vi.fn();

  beforeEach(() => {
    order = [];
    initCapacitor.mockImplementation(() => {
      order.push("capacitor");
    });
    initCapacitor.mockClear();
    reload.mockClear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
    });
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).androidBridge;
    vi.restoreAllMocks();
  });

  it("finishes unregistering the web worker before starting Capacitor", async () => {
    makeNative();
    // Unregistration is held open, so starting Capacitor early is visible.
    let finishUnregister!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finishUnregister = resolve;
    });
    installServiceWorkerMock({
      unregister: () => {
        order.push("unregister");
        return pending;
      },
      controlledAfter: false,
    });

    render(<RegisterSW />);

    await waitFor(() => expect(order).toContain("unregister"));
    expect(initCapacitor).not.toHaveBeenCalled();

    finishUnregister(true);
    await waitFor(() => expect(initCapacitor).toHaveBeenCalled());
    expect(order).toEqual(["unregister", "capacitor"]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when the page is still controlled, and never loops", async () => {
    makeNative();
    installServiceWorkerMock({ controlledAfter: true });

    const first = render(<RegisterSW />);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(initCapacitor).not.toHaveBeenCalled();
    first.unmount();

    // The reload brings the page back with the same session storage.
    render(<RegisterSW />);
    await waitFor(() => expect(initCapacitor).toHaveBeenCalled());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still starts Capacitor when a worker refuses to unregister", async () => {
    makeNative();
    installServiceWorkerMock({
      unregister: async () => {
        order.push("unregister");
        return false;
      },
      controlledAfter: false,
    });

    render(<RegisterSW />);

    await waitFor(() => expect(initCapacitor).toHaveBeenCalled());
    expect(order).toEqual(["unregister", "capacitor"]);
  });
});
