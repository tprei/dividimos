import pino, { type Logger, type LoggerOptions } from "pino";
import { isAppError } from "./errors";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  [key: string]: unknown;
}

export interface LoggerContext {
  /** Module or component name for log grouping */
  module?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** User ID for audit trails */
  userId?: string;
  /** Additional context */
  [key: string]: unknown;
}

let globalLogger: Logger | null = null;

/**
 * Get the log level from environment or default to 'info'.
 */
function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL as LogLevel;
  if (level && ["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) {
    return level;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Create base logger options.
 */
function createLoggerOptions(context?: LoggerContext): LoggerOptions {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    level: getLogLevel(),
    base: {
      ...(context?.module && { module: context.module }),
      ...(context?.requestId && { requestId: context.requestId }),
      ...(context?.userId && { userId: context.userId }),
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }),
  };
}

/**
 * Get or create the global logger instance.
 */
export function getLogger(context?: LoggerContext): Logger {
  if (!globalLogger) {
    globalLogger = pino(createLoggerOptions(context));
  } else if (context) {
    return globalLogger.child({
      ...(context.module && { module: context.module }),
      ...(context.requestId && { requestId: context.requestId }),
      ...(context.userId && { userId: context.userId }),
    });
  }
  return globalLogger;
}

/**
 * Create a child logger with additional context.
 */
export function createLogger(module: string, baseContext?: LogContext): Logger {
  return getLogger({ module, ...baseContext });
}

/**
 * Format an error for logging.
 */
function formatError(error: unknown): Record<string, unknown> {
  if (isAppError(error)) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      ...(error.context && { context: error.context }),
      ...(error.cause && { cause: formatError(error.cause) }),
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { error: String(error) };
}

/**
 * Log an error with full context.
 */
export function logError(
  logger: Logger,
  message: string,
  error: unknown,
  context?: LogContext
): void {
  const errorInfo = formatError(error);
  logger.error({ ...context, error: errorInfo }, message);
}

/**
 * Log a warning with optional context.
 */
export function logWarn(logger: Logger, message: string, context?: LogContext): void {
  logger.warn(context, message);
}

/**
 * Log an info message with optional context.
 */
export function logInfo(logger: Logger, message: string, context?: LogContext): void {
  logger.info(context ?? {}, message);
}

/**
 * Log a debug message with optional context.
 */
export function logDebug(logger: Logger, message: string, context?: LogContext): void {
  logger.debug(context, message);
}

/**
 * Server-side logger for API routes and server actions.
 * Automatically redacts sensitive fields.
 */
export const serverLogger = createLogger("server");

/**
 * Create a request-scoped logger with request ID for tracing.
 */
export function createRequestLogger(requestId: string, userId?: string): Logger {
  return getLogger({
    module: "api",
    requestId,
    ...(userId && { userId }),
  });
}

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// Re-export types
export type { Logger };
