import { describe, expect, it } from "vitest";
import { classifyLlmFailure } from "./llm-errors";

/** Shape the installed AI SDK throws for transport failures. */
function sdkError(status: number): Error & { status: number } {
  return Object.assign(new Error("provider said something internal"), { status });
}

function named(name: string): Error {
  const error = new Error("aborted");
  error.name = name;
  return error;
}

describe("classifyLlmFailure", () => {
  it("treats a quota rejection as retryable throttling", () => {
    expect(classifyLlmFailure(sdkError(429))).toEqual({
      status: 429,
      code: "LLM_QUOTA",
      retryable: true,
    });
  });

  it.each([500, 502, 503, 504])("treats upstream %i as a retryable outage", (status) => {
    expect(classifyLlmFailure(sdkError(status))).toEqual({
      status: 503,
      code: "LLM_UNAVAILABLE",
      retryable: true,
    });
  });

  it.each([401, 403])("treats %i as our own misconfiguration, not retryable", (status) => {
    expect(classifyLlmFailure(sdkError(status))).toEqual({
      status: 503,
      code: "LLM_CONFIG",
      retryable: false,
    });
  });

  it.each(["TimeoutError", "AbortError"])("maps %s to a retryable gateway timeout", (name) => {
    expect(classifyLlmFailure(named(name))).toEqual({
      status: 504,
      code: "LLM_TIMEOUT",
      retryable: true,
    });
  });

  it("classifies an abort even when it also carries a status", () => {
    const error = Object.assign(named("AbortError"), { status: 500 });
    expect(classifyLlmFailure(error).code).toBe("LLM_TIMEOUT");
  });

  it("falls back to a non-retryable internal failure for unknown shapes", () => {
    for (const value of [new Error("boom"), "string error", null, undefined, { status: "429" }]) {
      expect(classifyLlmFailure(value)).toEqual({
        status: 500,
        code: "LLM_INTERNAL",
        retryable: false,
      });
    }
  });

  it("reads a numeric code property when the SDK uses that name", () => {
    expect(classifyLlmFailure({ code: 429 }).code).toBe("LLM_QUOTA");
  });
});
