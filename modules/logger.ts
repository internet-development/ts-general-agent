import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync } from 'fs';
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

//NOTE(self): Log rotation — prevent unbounded disk growth during continuous operation
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB per file
const LOG_MAX_ROTATIONS = 3; // Keep 3 rotated copies
const LOG_MAX_DAYS = 14; // Prune daily files older than 14 days

export function initLogger(memoryPath: string, level: LogLevel = 'info'): void {
  logDir = join(memoryPath, 'logs');
  minLevel = level;

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  pruneOldLogFiles();
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

  //NOTE(self): Console output
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  console.log(`${prefix} ${entry.message}${contextStr}`);

  //NOTE(self): File output
  if (logDir) {
    try {
      const logFile = getLogFile();
      appendFileSync(logFile, line);
      maybeRotateLogFile(logFile);
    } catch {
      //NOTE(self): Silently fail file logging
    }
  }
}

//NOTE(self): Rotate individual log file at LOG_MAX_BYTES to prevent unbounded growth
function maybeRotateLogFile(filePath: string): void {
  try {
    if (!existsSync(filePath)) return;
    const stats = statSync(filePath);
    if (stats.size < LOG_MAX_BYTES) return;
    for (let i = LOG_MAX_ROTATIONS; i >= 1; i--) {
      const from = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const to = `${filePath}.${i}`;
      if (existsSync(from)) {
        renameSync(from, to);
      }
    }
  } catch {
    //NOTE(self): Non-fatal — next append creates a fresh file
  }
}

//NOTE(self): Prune daily log files older than LOG_MAX_DAYS to reclaim disk space
function pruneOldLogFiles(): void {
  if (!logDir) return;
  try {
    const files = readdirSync(logDir);
    const cutoff = Date.now() - LOG_MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      //NOTE(self): Match YYYY-MM-DD.log pattern (daily files)
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.log(\.(\d+))?$/);
      if (!match) continue;
      const fileDate = new Date(match[1]).getTime();
      if (isNaN(fileDate) || fileDate >= cutoff) continue;
      try {
        unlinkSync(join(logDir, file));
      } catch {
        //NOTE(self): Non-fatal — skip files that can't be deleted
      }
    }
  } catch {
    //NOTE(self): Non-fatal — pruning is best-effort
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
