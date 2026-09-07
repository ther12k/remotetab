/**
 * Stable protocol error codes (CONTROL_PROTOCOL.md). These cross the wire in
 * signaling `error` messages and gate user-facing copy, so they must not be
 * renamed casually.
 */
export const ERROR_CODES = [
  'PAIR_EXPIRED',
  'PAIR_INVALID_PROOF',
  'PAIR_ALREADY_USED',
  'DEVICE_REVOKED',
  'SESSION_NOT_FOUND',
  'SESSION_CONFLICT',
  'PEER_AUTH_FAILED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'MESSAGE_INVALID',
  'MESSAGE_TOO_LARGE',
  'REPLAY_REJECTED',
  'CAPTURE_NOT_ACTIVE',
  'INPUT_NOT_ATTACHED',
  'TARGET_TAB_CLOSED',
  'TURN_UNAVAILABLE',
  'CONNECTION_LOST',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
