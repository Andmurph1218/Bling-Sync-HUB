import { env } from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel): boolean {
  if (env.NODE_ENV === 'test' && level !== 'error') {
    return false;
  }
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[env.LOG_LEVEL];
}

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>): void => writeLog('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>): void => writeLog('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => writeLog('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>): void => writeLog('error', message, meta),
};
