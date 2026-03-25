import { NextResponse } from "next/server";
import { isAppError, toAppError } from "./errors";
import { createRequestLogger, generateRequestId } from "./logger";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    context?: Record<string, unknown>;
  };
}

export interface ApiSuccessResponse<T> {
  data: T;
  requestId: string;
}

/**
 * Create a standardized error response for API routes.
 */
export function apiErrorResponse(
  error: unknown,
  requestId: string
): NextResponse<ApiErrorResponse> {
  const appError = toAppError(error);
  const response: ApiErrorResponse = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      ...(appError.context && { context: appError.context }),
    },
  };

  return NextResponse.json(response, { status: appError.statusCode });
}

/**
 * Create a standardized success response for API routes.
 */
export function apiSuccessResponse<T>(
  data: T,
  requestId: string
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    data,
    requestId,
  });
}

/**
 * Higher-order function to wrap API route handlers with error handling and logging.
 */
export function withApiHandler<T>(
  handler: (request: Request, context: ApiHandlerContext) => Promise<T>
): (request: Request) => Promise<NextResponse<ApiSuccessResponse<T> | ApiErrorResponse>> {
  return async (request: Request): Promise<NextResponse<ApiSuccessResponse<T> | ApiErrorResponse>> => {
    const requestId = generateRequestId();
    const logger = createRequestLogger(requestId)

    try {
      logger.info({ method: request.method, url: request.url }, "API request started")

      const result = await handler(request, { requestId, logger })
      logger.info({ method: request.method, url: request.url }, "API request completed")
      return apiSuccessResponse(result, requestId)
    } catch (error) {
      logger.error(
        {
          method: request.method,
          url: request.url,
          error: isAppError(error)
            ? { code: error.code, message: error.message }
            : { message: String(error) },
        },
        "API request failed"
      )
      return apiErrorResponse(error, requestId)
    }
  }
}

export interface ApiHandlerContext {
  requestId: string;
  logger: ReturnType<typeof createRequestLogger>
}

/**
 * Get authenticated user from Supabase session.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedUser(
  supabase: SupabaseClient,
  logger: ReturnType<typeof createRequestLogger>
): Promise<{ id: string; email: string } | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    logger.debug({ error }, "No authenticated user found")
    return null
  }

  return {
    id: user.id,
    email: user.email ?? "",
  }
}

/**
 * Require authentication and return user info.
 * Throws an AppError if not authenticated
 */
export async function requireAuth(
  supabase: SupabaseClient,
  logger: ReturnType<typeof createRequestLogger>
): Promise<{ id: string; email: string }> {
  const user = await getAuthenticatedUser(supabase, logger)

  if (!user) {
    const { AuthError } = await import("./errors")
    throw new AuthError("AUTH_UNAUTHORIZED", "Authentication required")
  }

  return user
}
