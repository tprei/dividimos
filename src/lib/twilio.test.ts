import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the twilio module before importing our module
vi.mock("twilio", () => {
  const createMock = vi.fn();
  const verificationCheckCreateMock = vi.fn();

  const mockClient = {
    verify: {
      v2: {
        services: vi.fn(() => ({
          verifications: { create: createMock },
          verificationChecks: { create: verificationCheckCreateMock },
        })),
      },
    },
  };

  return {
    default: vi.fn(() => mockClient),
    __mockClient: mockClient,
    __createMock: createMock,
    __verificationCheckCreateMock: verificationCheckCreateMock,
  };
});

describe("twilio module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("test mode", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE = "true";
    });

    it("sendVerificationCode returns success without calling Twilio", async () => {
      const { sendVerificationCode } = await import("./twilio");
      const result = await sendVerificationCode("+5511999990001");
      expect(result).toEqual({ success: true });
    });

    it("checkVerificationCode accepts any 6-digit code", async () => {
      const { checkVerificationCode } = await import("./twilio");
      const result = await checkVerificationCode("+5511999990001", "123456");
      expect(result).toEqual({ success: true });
    });

    it("checkVerificationCode rejects non-6-digit codes", async () => {
      const { checkVerificationCode } = await import("./twilio");

      expect(await checkVerificationCode("+5511999990001", "12345")).toEqual({
        success: false,
      });
      expect(await checkVerificationCode("+5511999990001", "1234567")).toEqual({
        success: false,
      });
      expect(await checkVerificationCode("+5511999990001", "abcdef")).toEqual({
        success: false,
      });
      expect(await checkVerificationCode("+5511999990001", "")).toEqual({
        success: false,
      });
    });
  });

  describe("production mode", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE = "false";
      process.env.TWILIO_ACCOUNT_SID = "ACtest123";
      process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
      process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest123";
    });

    it("sendVerificationCode calls Twilio Verify API", async () => {
      const twilio = await import("twilio");
      const createMock = (twilio as unknown as { __createMock: ReturnType<typeof vi.fn> })
        .__createMock;
      createMock.mockResolvedValue({ status: "pending" });

      const { sendVerificationCode } = await import("./twilio");
      const result = await sendVerificationCode("+5511999990001");

      expect(result).toEqual({ success: true });
      expect(createMock).toHaveBeenCalledWith({
        to: "+5511999990001",
        channel: "sms",
      });
    });

    it("sendVerificationCode returns failure on non-pending status", async () => {
      const twilio = await import("twilio");
      const createMock = (twilio as unknown as { __createMock: ReturnType<typeof vi.fn> })
        .__createMock;
      createMock.mockResolvedValue({ status: "canceled" });

      const { sendVerificationCode } = await import("./twilio");
      const result = await sendVerificationCode("+5511999990001");

      expect(result).toEqual({ success: false });
    });

    it("checkVerificationCode calls Twilio Verify API", async () => {
      const twilio = await import("twilio");
      const checkMock = (
        twilio as unknown as {
          __verificationCheckCreateMock: ReturnType<typeof vi.fn>;
        }
      ).__verificationCheckCreateMock;
      checkMock.mockResolvedValue({ status: "approved" });

      const { checkVerificationCode } = await import("./twilio");
      const result = await checkVerificationCode("+5511999990001", "123456");

      expect(result).toEqual({ success: true });
      expect(checkMock).toHaveBeenCalledWith({
        to: "+5511999990001",
        code: "123456",
      });
    });

    it("checkVerificationCode returns failure on non-approved status", async () => {
      const twilio = await import("twilio");
      const checkMock = (
        twilio as unknown as {
          __verificationCheckCreateMock: ReturnType<typeof vi.fn>;
        }
      ).__verificationCheckCreateMock;
      checkMock.mockResolvedValue({ status: "pending" });

      const { checkVerificationCode } = await import("./twilio");
      const result = await checkVerificationCode("+5511999990001", "123456");

      expect(result).toEqual({ success: false });
    });

    it("throws when TWILIO_ACCOUNT_SID is missing", async () => {
      delete process.env.TWILIO_ACCOUNT_SID;

      const { sendVerificationCode } = await import("./twilio");
      await expect(sendVerificationCode("+5511999990001")).rejects.toThrow(
        "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set"
      );
    });

    it("throws when TWILIO_VERIFY_SERVICE_SID is missing", async () => {
      delete process.env.TWILIO_VERIFY_SERVICE_SID;

      const { sendVerificationCode } = await import("./twilio");
      await expect(sendVerificationCode("+5511999990001")).rejects.toThrow(
        "TWILIO_VERIFY_SERVICE_SID must be set"
      );
    });
  });
});
