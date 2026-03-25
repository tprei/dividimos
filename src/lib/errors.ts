/**
 * Typed error system for consistent error handling across the application.
 *
 * All errors have:
 * - A machine-readable code for programmatic handling
 * - A user-friendly message
 * - Optional context for debugging
 */

export type ErrorCode =
  // Authentication & Authorization
  | "AUTH_UNAUTHORIZED"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_USER_NOT_FOUND"
  // User operations
  | "USER_NOT_FOUND"
  | "USER_ALREADY_EXISTS"
  | "USER_INVALID_HANDLE"
  | "USER_PIX_KEY_REQUIRED"
  // Bill operations
  | "BILL_NOT_FOUND"
  | "BILL_INVALID_STATE"
  | "BILL_SYNC_FAILED"
  | "BILL_FINALIZE_FAILED"
  // Draft operations
  | "DRAFT_NOT_FOUND"
  | "DRAFT_SAVE_FAILED"
  | "DRAFT_DELETE_FAILED"
  // Group operations
  | "GROUP_NOT_FOUND"
  | "GROUP_MEMBER_NOT_FOUND"
  | "GROUP_ALREADY_MEMBER"
  // Pix operations
  | "PIX_KEY_INVALID"
  | "PIX_KEY_ENCRYPTION_FAILED"
  | "PIX_GENERATION_FAILED"
  // Database operations
  | "DB_QUERY_FAILED"
  | "DB_INSERT_FAILED"
  | "DB_UPDATE_FAILED"
  | "DB_DELETE_FAILED"
  // Validation
  | "VALIDATION_ERROR"
  | "VALIDATION_REQUIRED_FIELD"
  | "VALIDATION_INVALID_FORMAT"
  // External services
  | "EXTERNAL_SERVICE_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  // Generic
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED";

export interface ErrorContext {
  [key: string]: unknown;
}

/**
 * Base application error class with typed error codes.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context?: ErrorContext;
  public readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      context?: ErrorContext;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = options?.statusCode ?? this.getDefaultStatusCode(code);
    this.context = options?.context;
    this.cause = options?.cause;

    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  private getDefaultStatusCode(code: ErrorCode): number {
    switch (code) {
      case "AUTH_UNAUTHORIZED":
      case "AUTH_SESSION_EXPIRED":
      case "AUTH_INVALID_TOKEN":
        return 401;
      case "USER_NOT_FOUND":
      case "BILL_NOT_FOUND":
      case "DRAFT_NOT_FOUND":
      case "GROUP_NOT_FOUND":
      case "GROUP_MEMBER_NOT_FOUND":
        return 404;
      case "USER_ALREADY_EXISTS":
      case "GROUP_ALREADY_MEMBER":
        return 409;
      case "VALIDATION_ERROR":
      case "VALIDATION_REQUIRED_FIELD":
      case "VALIDATION_INVALID_FORMAT":
      case "USER_INVALID_HANDLE":
      case "USER_PIX_KEY_REQUIRED":
      case "PIX_KEY_INVALID":
      case "BILL_INVALID_STATE":
        return 400;
      case "RATE_LIMIT_EXCEEDED":
        return 429;
      case "NOT_IMPLEMENTED":
        return 501;
      default:
        return 500;
    }
  }

  /**
   * Convert to a JSON-serializable format for API responses.
   */
  toJSON(): { error: { code: ErrorCode; message: string; context?: ErrorContext } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.context && { context: this.context }),
      },
    };
  }
}

/**
 * Authentication-related errors.
 */
export class AuthError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      "AUTH_UNAUTHORIZED" | "AUTH_SESSION_EXPIRED" | "AUTH_INVALID_TOKEN" | "AUTH_USER_NOT_FOUND"
    >,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "AuthError";
  }
}

/**
 * User operation errors.
 */
export class UserError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      | "USER_NOT_FOUND"
      | "USER_ALREADY_EXISTS"
      | "USER_INVALID_HANDLE"
      | "USER_PIX_KEY_REQUIRED"
    >,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "UserError";
  }
}

/**
 * Bill operation errors.
 */
export class BillError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      "BILL_NOT_FOUND" | "BILL_INVALID_STATE" | "BILL_SYNC_FAILED" | "BILL_FINALIZE_FAILED"
    >,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "BillError";
  }
}

/**
 * Draft operation errors.
 */
export class DraftError extends AppError {
  constructor(
    code: Extract<ErrorCode, "DRAFT_NOT_FOUND" | "DRAFT_SAVE_FAILED" | "DRAFT_DELETE_FAILED">,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "DraftError";
  }
}

/**
 * Group operation errors.
 */
export class GroupError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      "GROUP_NOT_FOUND" | "GROUP_MEMBER_NOT_FOUND" | "GROUP_ALREADY_MEMBER"
    >,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "GroupError";
  }
}

/**
 * Pix-related errors.
 */
export class PixError extends AppError {
  constructor(
    code: Extract<
      ErrorCode,
      "PIX_KEY_INVALID" | "PIX_KEY_ENCRYPTION_FAILED" | "PIX_GENERATION_FAILED"
    >,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "PixError";
  }
}

/**
 * Database operation errors.
 */
export class DatabaseError extends AppError {
  constructor(
    code: Extract<ErrorCode, "DB_QUERY_FAILED" | "DB_INSERT_FAILED" | "DB_UPDATE_FAILED" | "DB_DELETE_FAILED">,
    message: string,
    options?: { context?: ErrorContext; cause?: Error }
  ) {
    super(code, message, options);
    this.name = "DatabaseError";
  }
}

/**
 * Validation errors for user input.
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    options?: {
      code?: Extract<ErrorCode, "VALIDATION_ERROR" | "VALIDATION_REQUIRED_FIELD" | "VALIDATION_INVALID_FORMAT">;
      context?: ErrorContext;
      cause?: Error;
    }
  ) {
    super(options?.code ?? "VALIDATION_ERROR", message, options);
    this.name = "ValidationError";
  }
}

/**
 * Check if an error is an AppError instance.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Check if an error has a specific error code.
 */
export function hasErrorCode(error: unknown, code: ErrorCode): error is AppError {
  return isAppError(error) && error.code === code;
}

/**
 * Convert unknown errors to AppError for consistent handling.
 */
export function toAppError(error: unknown, fallbackMessage = "An unexpected error occurred"): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError("INTERNAL_ERROR", error.message ?? fallbackMessage, {
      cause: error,
    });
  }

  return new AppError("INTERNAL_ERROR", fallbackMessage, {
    context: { originalError: String(error) },
  });
}
