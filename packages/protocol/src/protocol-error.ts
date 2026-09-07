import { ERROR_CODES, type ErrorCode } from './errors.ts';

/**
 * Typed protocol error. Messages are safe to show/log: constructors must never
 * embed user content, prompt text, keys, or secrets.
 */
export class ProtocolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, reason: string, options?: { cause?: unknown }) {
    super(`${code}: ${reason}`, options);
    this.name = 'ProtocolError';
    this.code = code;
  }

  static isCode(value: unknown, code: ErrorCode): value is ProtocolError {
    return value instanceof ProtocolError && value.code === code;
  }
}

/** All stable codes re-exported for exhaustiveness checks. */
export const CODES = ERROR_CODES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
