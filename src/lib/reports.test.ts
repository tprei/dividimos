import { describe, expect, it } from "vitest";
import { LedgerError } from "@/lib/sync/errors";
import {
  formatReportNotification,
  isReportReason,
  isReportUuid,
  parseReportInput,
  type ReportNotification,
} from "@/lib/reports";

const UUID = "6f1a2b3c-4d5e-4f60-8a71-9b0c1d2e3f40";

function notification(overrides: Partial<ReportNotification> = {}): ReportNotification {
  return {
    report_id: UUID,
    reason: "assedio",
    details: null,
    message_snapshot: null,
    reporter_handle: "ana",
    target_handle: "bruno",
    group_name: null,
    ...overrides,
  };
}

describe("parseReportInput", () => {
  it("rejects non-objects, arrays, and null payloads", () => {
    for (const value of [null, 42, "denúncia", [], true]) {
      expect(() => parseReportInput(value)).toThrow(LedgerError);
      try {
        parseReportInput(value);
      } catch (error) {
        expect((error as LedgerError).code).toBe("invalid_argument");
      }
    }
  });

  it("rejects invalid uuids, categories, and detail types", () => {
    const valid = { targetUserId: UUID, reason: "assedio" };
    for (const bad of [
      { ...valid, targetUserId: "nao-e-um-uuid" },
      { ...valid, reason: "spamzao" },
      { ...valid, reason: 42 },
      { ...valid, messageId: "curto" },
      { ...valid, details: 42 },
      { ...valid, details: true },
      { ...valid, details: "\u0000esconde um nulo" },
      { ...valid, details: "quebra\r\nwindows" },
    ]) {
      expect(() => parseReportInput(bad)).toThrow(LedgerError);
    }
    expect(
      parseReportInput({ ...valid, details: "linha\nnova e\ttabulada" }).details,
    ).toBe("linha\nnova e\ttabulada");
  });

  it("normalizes optional values and trims details", () => {
    expect(parseReportInput({ targetUserId: UUID, reason: "outro" })).toEqual({
      targetUserId: UUID,
      messageId: null,
      reason: "outro",
      details: null,
    });
    expect(
      parseReportInput({
        targetUserId: UUID,
        messageId: UUID,
        reason: "golpe_ou_spam",
        details: "  com espaços  ",
      }),
    ).toEqual({
      targetUserId: UUID,
      messageId: UUID,
      reason: "golpe_ou_spam",
      details: "com espaços",
    });
    expect(
      parseReportInput({ targetUserId: UUID, reason: "outro", details: "   " }).details,
    ).toBeNull();
    expect(isReportReason("assedio")).toBe(true);
    expect(isReportReason("nao-existe")).toBe(false);
    expect(isReportUuid(UUID)).toBe(true);
    expect(isReportUuid("nao")).toBe(false);
  });

  it("counts the code-point limit, not UTF-16 units", () => {
    const emoji = "😀".repeat(1000);
    expect(() =>
      parseReportInput({ targetUserId: UUID, reason: "outro", details: emoji }),
    ).not.toThrow();
    expect(() =>
      parseReportInput({ targetUserId: UUID, reason: "outro", details: `${emoji}😀` }),
    ).toThrow(LedgerError);
  });
});

describe("formatReportNotification", () => {
  it("keeps markup-like evidence as plain data", () => {
    const text = formatReportNotification(
      notification({
        details: "<b>negrito</b> e *itálico* em <i>HTML</i>",
      }),
    );
    const detailsLine = text.split("\n").find((line) => line.startsWith("Detalhes:"));
    expect(detailsLine).toBe("Detalhes: <b>negrito</b> e *itálico* em <i>HTML</i>");
  });

  it("sends handles without the mention-forming @ prefix", () => {
    const text = formatReportNotification(notification());
    expect(text).toContain("Quem denunciou: ana");
    expect(text).toContain("Pessoa denunciada: bruno");
    expect(text).not.toContain("@ana");
    expect(text).not.toContain("@bruno");
  });

  it("collapses newlines, control, and bidi injection in evidence", () => {
    const text = formatReportNotification(
      notification({
        details: "linha1\nlinha2\u202Ereversed\u0000fim",
        message_snapshot: "parágrafo\r\ncom\rquebra\u200Fmark",
      }),
    );
    expect(text).not.toMatch(/linha1\nlinha2/);
    expect(text).not.toContain("\u202E");
    expect(text).not.toContain("\u0000");
    expect(text).not.toContain("\u200F");
    expect(text).toContain("linha1 linha2 reversed fim");
  });

  it("truncates emoji evidence without half-surrogates", () => {
    const snapshot = "😀".repeat(600);
    const text = formatReportNotification(notification({ message_snapshot: snapshot }));
    const messageLine = text.split("\n").find((line) => line.startsWith("Mensagem:"));
    expect(messageLine).toBeDefined();
    const preview = messageLine!.slice("Mensagem: ".length);
    expect(preview.endsWith("…")).toBe(true);
    for (const char of Array.from(preview)) {
      expect(char).not.toMatch(/[\uD800-\uDBFF]$/);
    }
    expect(Array.from(preview.slice(0, -1)).length).toBeLessThanOrEqual(500);
  });

  it("bounds maximum output below the Telegram 4096 limit", () => {
    const text = formatReportNotification(
      notification({
        reporter_handle: "r".repeat(400),
        target_handle: "t".repeat(400),
        group_name: "g".repeat(5000),
        message_snapshot: "m".repeat(5000),
        details: "d".repeat(5000),
      }),
    );
    expect(text.length).toBeLessThan(4096);
  });

  it("distinguishes null evidence without inventing text", () => {
    const text = formatReportNotification(notification());
    expect(text).toContain("Grupo: Sem grupo disponível");
    expect(text).toContain("Mensagem: Sem texto disponível");
    expect(text).toContain("Detalhes: Não informados");
    expect(text).toContain(`Denúncia Dividimos: ${UUID}`);
  });
});
