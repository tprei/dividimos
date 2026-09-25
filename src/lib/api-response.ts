import { NextResponse } from "next/server";
import { toAppError } from "./errors";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    context?: Record<string, unknown>;
  };
}

/** Client-facing message for server-side (5xx) errors, whose real message may
 *  carry SQL column names, RLS detail, or other internals. */
const GENERIC_SERVER_ERROR_MESSAGE = "An unexpected error occurred";

/**
 * Create a standardized error response for API routes.
 *
 * Messages for server-side (5xx) errors are redacted to a generic string and
 * their context is dropped, since `toAppError` copies raw `Error.message` (often
 * a Postgres/RLS detail) into the wrapped `INTERNAL_ERROR`. Client errors (4xx)
 * carry intentional, user-facing messages and are passed through.
 */
export function apiErrorResponse(
  error: unknown,
  requestId: string
): NextResponse<ApiErrorResponse> {
  const appError = toAppError(error);
  const isServerError = appError.statusCode >= 500;
  const response: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: isServerError ? GENERIC_SERVER_ERROR_MESSAGE : appError.message,
      requestId,
      ...(!isServerError && appError.context && { context: appError.context }),
    },
  };

  return NextResponse.json(response, { status: appError.statusCode });
}
