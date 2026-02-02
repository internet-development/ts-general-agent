import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logDir: string | null = null;
let minLevel: LogLevel = 'info';

export function initLogger(memoryPath: string, level: LogLevel = 'info'): void {
  logDir = join(memoryPath, 'logs');
  minLevel = level;

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function getLogFile(): string {
  if (!logDir) {
    throw new Error('Logger not initialized');
  }
  const date = new Date().toISOString().split('T')[0];
  return join(logDir, `${date}.log`);
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry) + '\n';

  // Console output
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  console.log(`${prefix} ${entry.message}${contextStr}`);

  // File output
  if (logDir) {
    try {
      appendFileSync(getLogFile(), line);
    } catch {
      // Silently fail file logging
    }
  }
}

export function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    context,
  };

  writeLog(entry);
}

export function debug(message: string, context?: Record<string, unknown>): void {
  log('debug', message, context);
}

export function info(message: string, context?: Record<string, unknown>): void {
  log('info', message, context);
}

export function warn(message: string, context?: Record<string, unknown>): void {
  log('warn', message, context);
}

export function error(message: string, context?: Record<string, unknown>): void {
  log('error', message, context);
}

export const logger = { debug, info, warn, error, log, initLogger };
