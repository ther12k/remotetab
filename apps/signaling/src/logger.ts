/**
 * Structured, redacted JSON logger. NEVER log message payloads, SDP bodies,
 * device display names, pairing secrets, or page content — only shapes,
 * sizes, and opaque routing ids.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  minLevel: LogLevel,
  sink: (line: string) => void = console.log,
): Logger {
  const min = LEVELS[minLevel] ?? LEVELS.info;
  const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < min) return;
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        ...fields,
      }),
    );
  };
  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
