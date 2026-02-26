/**
 * Lightweight structured logger for server-side code.
 * Outputs JSON lines for easy parsing by log aggregators while remaining readable.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('PRD created', { prdId: '123', userId: 'abc' });
 *   logger.error('Failed to save', { error: err.message, prdId: '123' });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const MAX_STRING_LENGTH = 300;
const MAX_ARRAY_PREVIEW = 20;
const MAX_OBJECT_DEPTH = 4;
const VERBOSE_LOGGING_ENABLED = process.env.ENABLE_VERBOSE_LOGS === "true";
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const DEFAULT_LOG_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ||
  (process.env.NODE_ENV === "production" ? "warn" : "info");

const SENSITIVE_EXACT_KEYS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "password",
  "requestbody",
  "response",
  "payload",
  "content",
  "text",
  "projectidea",
  "featurelist",
  "feedback",
  "answers",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }

  return /(token|secret|password|apikey|authorization|cookie)/.test(normalized);
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function sanitizeValue(value: unknown, depth: number, keyHint?: string): unknown {
  if (keyHint && isSensitiveKey(keyHint)) {
    if (typeof value === "string") {
      return `[REDACTED len=${value.length}]`;
    }
    if (Array.isArray(value)) {
      return `[REDACTED array len=${value.length}]`;
    }
    if (value && typeof value === "object") {
      return "[REDACTED object]";
    }
    return "[REDACTED]";
  }

  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message || ""),
    };
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_OBJECT_DEPTH) {
      return `[Array len=${value.length}]`;
    }

    if (value.length > MAX_ARRAY_PREVIEW) {
      return {
        preview: value.slice(0, MAX_ARRAY_PREVIEW).map((item) => sanitizeValue(item, depth + 1)),
        truncated: value.length - MAX_ARRAY_PREVIEW,
      };
    }

    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= MAX_OBJECT_DEPTH) {
      return "[Object]";
    }

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeValue(v, depth + 1, k);
    }
    return out;
  }

  return String(value);
}

export function sanitizeForLogging(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }

  return sanitizeValue(meta, 0) as Record<string, unknown>;
}

function formatEntry(level: LogLevel, msg: string, meta?: Record<string, unknown>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...(sanitizeForLogging(meta) || {}),
  };
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[DEFAULT_LOG_LEVEL];
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (!VERBOSE_LOGGING_ENABLED) {
      return;
    }
    if (!shouldLog("debug")) {
      return;
    }
    const entry = formatEntry("debug", msg, meta);
    console.debug(JSON.stringify(entry));
  },

  info(msg: string, meta?: Record<string, unknown>) {
    if (!shouldLog("info")) {
      return;
    }
    const entry = formatEntry('info', msg, meta);
    console.log(JSON.stringify(entry));
  },

  warn(msg: string, meta?: Record<string, unknown>) {
    if (!shouldLog("warn")) {
      return;
    }
    const entry = formatEntry('warn', msg, meta);
    console.warn(JSON.stringify(entry));
  },

  error(msg: string, meta?: Record<string, unknown>) {
    if (!shouldLog("error")) {
      return;
    }
    const entry = formatEntry('error', msg, meta);
    console.error(JSON.stringify(entry));
  },
};
