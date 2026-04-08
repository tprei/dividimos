import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateRequestId,
  createRequestLogger,
  createLogger,
  logError,
  logInfo,
  logDebug,
  type Logger,
} from "./logger";
import { AppError } from "./errors";

describe("generateRequestId", () => {
  it("returns a string with timestamp and random parts separated by hyphen", () => {
    const id = generateRequestId();
    expect(typeof id).toBe("string");
    const parts = id.split("-");
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("generates unique ids on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRequestId()));
    expect(ids.size).toBe(20);
  });

  it("encodes the timestamp portion as base-36", () => {
    const before = Date.now();
    const id = generateRequestId();
    const after = Date.now();
    const timestampPart = id.split("-")[0];
    const decoded = parseInt(timestampPart, 36);
    expect(decoded).toBeGreaterThanOrEqual(before);
    expect(decoded).toBeLessThanOrEqual(after);
  });
});

describe("createLogger", () => {
  it("returns a logger with all log-level methods", () => {
    const logger = createLogger("test-module");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");
  });
});

describe("createRequestLogger", () => {
  it("returns a logger with all log-level methods", () => {
    const logger = createRequestLogger("req-123");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("accepts optional userId", () => {
    const logger = createRequestLogger("req-123", "user-456");
    expect(typeof logger.info).toBe("function");
  });
});

describe("log helper functions", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    };
  });

  describe("logInfo", () => {
    it("calls logger.info with context and message", () => {
      logInfo(mockLogger, "hello", { key: "val" });
      expect(mockLogger.info).toHaveBeenCalledWith({ key: "val" }, "hello");
    });

    it("passes empty object when no context given", () => {
      logInfo(mockLogger, "hello");
      expect(mockLogger.info).toHaveBeenCalledWith({}, "hello");
    });
  });

  describe("logDebug", () => {
    it("calls logger.debug with context and message", () => {
      logDebug(mockLogger, "detail", { step: 1 });
      expect(mockLogger.debug).toHaveBeenCalledWith({ step: 1 }, "detail");
    });
  });

  describe("logError", () => {
    it("formats AppError and passes to logger.error", () => {
      const appErr = new AppError("BILL_NOT_FOUND", "not found", {
        context: { billId: "abc" },
      });
      logError(mockLogger, "failed", appErr);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [ctx, msg] = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(msg).toBe("failed");
      expect(ctx.error).toMatchObject({
        name: "AppError",
        code: "BILL_NOT_FOUND",
        message: "not found",
        statusCode: 404,
        context: { billId: "abc" },
      });
    });

    it("formats plain Error", () => {
      logError(mockLogger, "oops", new Error("boom"));
      const [ctx] = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(ctx.error).toMatchObject({
        name: "Error",
        message: "boom",
      });
    });

    it("formats non-Error values", () => {
      logError(mockLogger, "oops", "string error");
      const [ctx] = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(ctx.error).toEqual({ error: "string error" });
    });

    it("merges additional context", () => {
      logError(mockLogger, "oops", new Error("x"), { requestId: "r1" });
      const [ctx] = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(ctx.requestId).toBe("r1");
      expect(ctx.error).toBeDefined();
    });
  });
});
