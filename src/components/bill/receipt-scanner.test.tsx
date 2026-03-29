import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceiptScanner } from "./receipt-scanner";

function createMockFile(name = "receipt.jpg", type = "image/jpeg"): File {
  return new File(["fake-image-data"], name, { type });
}

// Stub URL.createObjectURL / revokeObjectURL for happy-dom
const fakeUrl = "blob:http://localhost/fake-preview";
beforeEach(() => {
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => fakeUrl),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReceiptScanner", () => {
  it("renders heading and description", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Escanear nota")).toBeInTheDocument();
    expect(
      screen.getByText("Tire uma foto ou escolha da galeria."),
    ).toBeInTheDocument();
  });

  it("renders camera and gallery buttons initially", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("Galeria")).toBeInTheDocument();
    expect(screen.getByText("Tirar foto agora")).toBeInTheDocument();
    expect(screen.getByText("Escolher foto")).toBeInTheDocument();
  });

  it("does not show preview or process button initially", () => {
    render(<ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />);

    expect(screen.queryByText("Processar")).not.toBeInTheDocument();
    expect(
      screen.queryByAltText("Foto da nota fiscal"),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ReceiptScanner onProcess={vi.fn()} onBack={onBack} />);

    const backBtn = screen.getByLabelText("Voltar");
    await user.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("has two hidden file inputs (camera and gallery)", () => {
    const { container } = render(
      <ReceiptScanner onProcess={vi.fn()} onBack={vi.fn()} />,
    );

    const fileInputs = container.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(2);

    // Camera input has capture attribute
    const cameraInput = container.querySelector(
      'input[type="file"][capture="environment"]',
    );
    expect(cameraInput).not.toBeNull();
    expect(cameraInput).toHaveAttribute("accept", "image/*");

    // Gallery input has no capture attribute
    const allInputs = Array.from(fileInputs);
    const galleryInput = allInputs.find(
      (input) => !input.hasAttribute("capture"),
    );
    expect(galleryInput).not.toBeNull();
    expect(galleryInput).toHaveAttribute("accept", "image/*");
  });

  describe("after selecting a file", () => {
    async function selectFile() {
      const onProcess = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <ReceiptScanner onProcess={onProcess} onBack={vi.fn()} />,
      );

      // Simulate file selection on the gallery input (no capture attribute)
      const fileInputs = container.querySelectorAll('input[type="file"]');
      const galleryInput = Array.from(fileInputs).find(
        (input) => !input.hasAttribute("capture"),
      ) as HTMLInputElement;

      const mockFile = createMockFile();
      await user.upload(galleryInput, mockFile);

      return { onProcess, mockFile, container };
    }

    it("shows image preview after file selection", async () => {
      await selectFile();

      const img = screen.getByAltText("Foto da nota fiscal");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", fakeUrl);
    });

    it("shows Processar and Trocar foto buttons", async () => {
      await selectFile();

      expect(screen.getByText("Processar")).toBeInTheDocument();
      expect(screen.getByText("Trocar foto")).toBeInTheDocument();
    });

    it("hides camera/gallery buttons when preview is shown", async () => {
      await selectFile();

      expect(screen.queryByText("Camera")).not.toBeInTheDocument();
      expect(screen.queryByText("Galeria")).not.toBeInTheDocument();
    });

    it("calls onProcess with the file when Processar is clicked", async () => {
      const { onProcess, mockFile } = await selectFile();
      const user = userEvent.setup();

      const processBtn = screen.getByText("Processar").closest("button")!;
      await user.click(processBtn);
      expect(onProcess).toHaveBeenCalledWith(mockFile);
    });

    it("clears preview when Trocar foto is clicked", async () => {
      await selectFile();
      const user = userEvent.setup();

      const changeBtn = screen.getByText("Trocar foto").closest("button")!;
      await user.click(changeBtn);

      // Should go back to input mode
      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(screen.getByText("Galeria")).toBeInTheDocument();
      expect(
        screen.queryByAltText("Foto da nota fiscal"),
      ).not.toBeInTheDocument();
    });

    it("clears preview when X button on image is clicked", async () => {
      await selectFile();
      const user = userEvent.setup();

      const removeBtn = screen.getByLabelText("Remover foto");
      await user.click(removeBtn);

      expect(screen.getByText("Camera")).toBeInTheDocument();
      expect(
        screen.queryByAltText("Foto da nota fiscal"),
      ).not.toBeInTheDocument();
    });

    it("revokes old object URL when clearing preview", async () => {
      await selectFile();
      const user = userEvent.setup();

      const changeBtn = screen.getByText("Trocar foto").closest("button")!;
      await user.click(changeBtn);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(fakeUrl);
    });
  });

  describe("processing state", () => {
    it("shows Processando... when processing is true", async () => {
      const { container } = render(
        <ReceiptScanner
          onProcess={vi.fn()}
          onBack={vi.fn()}
          processing={true}
        />,
      );

      // First select a file to show preview
      const fileInputs = container.querySelectorAll('input[type="file"]');
      const galleryInput = Array.from(fileInputs).find(
        (input) => !input.hasAttribute("capture"),
      ) as HTMLInputElement;

      const user = userEvent.setup();
      await user.upload(galleryInput, createMockFile());

      expect(screen.getByText("Processando...")).toBeInTheDocument();
    });

    it("disables buttons when processing", async () => {
      const { container } = render(
        <ReceiptScanner
          onProcess={vi.fn()}
          onBack={vi.fn()}
          processing={true}
        />,
      );

      const fileInputs = container.querySelectorAll('input[type="file"]');
      const galleryInput = Array.from(fileInputs).find(
        (input) => !input.hasAttribute("capture"),
      ) as HTMLInputElement;

      const user = userEvent.setup();
      await user.upload(galleryInput, createMockFile());

      const processBtn = screen.getByText("Processando...").closest("button")!;
      const changeBtn = screen.getByText("Trocar foto").closest("button")!;

      expect(processBtn).toBeDisabled();
      expect(changeBtn).toBeDisabled();
    });
  });
});
