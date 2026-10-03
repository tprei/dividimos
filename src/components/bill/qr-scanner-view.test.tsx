import { render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockScanner = {
  start: Mock;
  pause: Mock;
  destroy: Mock;
};

const qr = vi.hoisted(() => {
  const instances: MockScanner[] = [];
  const state = { gate: null as Promise<void> | null, startError: null as string | null };
  class MockQrScanner implements MockScanner {
    start = vi.fn(() => {
      if (state.startError !== null) return Promise.reject(state.startError);
      return state.gate ? state.gate : Promise.resolve();
    });
    pause = vi.fn(() => Promise.resolve(true));
    destroy = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  return { instances, state, MockQrScanner };
});

const settings = vi.hoisted(() => ({ ios: false, open: vi.fn() }));

vi.mock("qr-scanner", () => ({ default: qr.MockQrScanner }));
vi.mock("@/lib/capacitor/app-settings", () => ({
  opensAppSettings: () => settings.ios,
  openAppSettings: () => settings.open(),
}));

import { QrScannerView } from "./qr-scanner-view";

const baseProps = { onDecode: vi.fn() };

function lastInstance(): MockScanner {
  const instance = qr.instances[qr.instances.length - 1];
  if (!instance) throw new Error("no scanner was created");
  return instance;
}

function holdStart() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = () => {
      qr.state.gate = null;
      resolve();
    };
  });
  qr.state.gate = gate;
  return release;
}

beforeEach(() => {
  qr.instances.length = 0;
  qr.state.gate = null;
  qr.state.startError = null;
  settings.ios = false;
  settings.open.mockClear();
});

describe("QrScannerView camera lifecycle", () => {
  it("leaves a still-starting camera alone while collapsed, then applies the collapsed state once ready", async () => {
    const release = holdStart();
    const { rerender } = render(<QrScannerView {...baseProps} />);
    await waitFor(() => expect(qr.instances).toHaveLength(1));
    const scanner = lastInstance();
    expect(scanner.start).toHaveBeenCalledTimes(1);

    rerender(<QrScannerView {...baseProps} collapsed />);
    expect(scanner.pause).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(scanner.pause).toHaveBeenCalledWith(true));
    expect(scanner.start).toHaveBeenCalledTimes(1);

    rerender(<QrScannerView {...baseProps} />);
    await waitFor(() => expect(scanner.start).toHaveBeenCalledTimes(2));
    expect(scanner.pause).toHaveBeenCalledTimes(1);
  });

  it("keeps the already-starting camera running when the keyboard closes before start resolves", async () => {
    const release = holdStart();
    const { rerender } = render(<QrScannerView {...baseProps} collapsed />);
    await waitFor(() => expect(qr.instances).toHaveLength(1));
    const scanner = lastInstance();

    rerender(<QrScannerView {...baseProps} />);

    release();
    await waitFor(() =>
      expect(screen.queryByText("Iniciando câmera…")).not.toBeInTheDocument(),
    );
    expect(scanner.start).toHaveBeenCalledTimes(1);
    expect(scanner.pause).not.toHaveBeenCalled();
    expect(qr.instances).toHaveLength(1);
  });
});

describe("QrScannerView refused camera", () => {
  // qr-scanner rejects with this string whatever getUserMedia threw.
  function refuseCamera() {
    qr.state.startError = "Camera not found.";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("points the iPhone app to Ajustes", async () => {
    settings.ios = true;
    refuseCamera();
    render(<QrScannerView {...baseProps} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Permita o acesso à câmera nos Ajustes.");
    screen.getByRole("button", { name: "Abrir Ajustes" }).click();
    expect(settings.open).toHaveBeenCalledOnce();
  });

  it("keeps the browser guidance on the web", async () => {
    refuseCamera();
    render(<QrScannerView {...baseProps} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Habilite nas configurações do navegador.");
    expect(screen.queryByRole("button", { name: "Abrir Ajustes" })).toBeNull();
  });
});
