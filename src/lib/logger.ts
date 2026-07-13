import { isAppError } from "./errors";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  [key: string]: unknown;
}

export interface LoggerContext {
  module?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface Logger {
  trace(obj: LogContext | undefined, msg: string): void;
  debug(obj: LogContext | undefined, msg: string): void;
  info(obj: LogContext | undefined, msg: string): void;
  warn(obj: LogContext | undefined, msg: string): void;
  error(obj: LogContext | undefined, msg: string): void;
  fatal(obj: LogContext | undefined, msg: string): void;
  child(bindings: LogContext): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function getLogLevel(): LogLevel {
  const level = (typeof process !== "undefined" && process.env?.LOG_LEVEL) as LogLevel | undefined;
  if (level && level in LEVELS) return level;
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production" ? "info" : "debug";
}

function createLoggerInstance(base: LogContext = {}): Logger {
  const minLevel = LEVELS[getLogLevel()];

  function log(level: LogLevel, obj: LogContext | undefined, msg: string) {
    if (LEVELS[level] < minLevel) return;
    const data = { ...base, ...(obj ?? {}), level };
    const consoleFn =
      level === "error" || level === "fatal"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug" || level === "trace"
            ? console.debug
            : console.log;
    consoleFn(`[${level.toUpperCase()}] ${msg}`, data);
  }

  return {
    trace: (obj, msg) => log("trace", obj, msg),
    debug: (obj, msg) => log("debug", obj, msg),
    info: (obj, msg) => log("info", obj, msg),
    warn: (obj, msg) => log("warn", obj, msg),
    error: (obj, msg) => log("error", obj, msg),
    fatal: (obj, msg) => log("fatal", obj, msg),
    child: (bindings) => createLoggerInstance({ ...base, ...bindings }),
  };
}

let globalLogger: Logger | null = null;

export function getLogger(context?: LoggerContext): Logger {
  if (!globalLogger) {
    globalLogger = createLoggerInstance({
      ...(context?.module && { module: context.module }),
      ...(context?.requestId && { requestId: context.requestId }),
      ...(context?.userId && { userId: context.userId }),
    });
  } else if (context) {
    return globalLogger.child({
      ...(context.module && { module: context.module }),
      ...(context.requestId && { requestId: context.requestId }),
      ...(context.userId && { userId: context.userId }),
    });
  }
  return globalLogger;
}

export function createLogger(module: string, baseContext?: LogContext): Logger {
  return getLogger({ module, ...baseContext });
}

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

export function logError(logger: Logger, message: string, error: unknown, context?: LogContext): void {
  const errorInfo = formatError(error);
  logger.error({ ...context, error: errorInfo }, message);
}

export function logWarn(logger: Logger, message: string, context?: LogContext): void {
  logger.warn(context, message);
}

export function logInfo(logger: Logger, message: string, context?: LogContext): void {
  logger.info(context ?? {}, message);
}

export function logDebug(logger: Logger, message: string, context?: LogContext): void {
  logger.debug(context, message);
}

export function createRequestLogger(requestId: string, userId?: string): Logger {
  return getLogger({
    module: "api",
    requestId,
    ...(userId && { userId }),
  });
}

export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
