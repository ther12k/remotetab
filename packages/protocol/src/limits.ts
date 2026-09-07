/**
 * Wire-level size and content bounds. Every network message is checked against
 * these BEFORE parsing or any expensive work (fail fast, fail closed).
 */

/** Max serialized control DataChannel frame (JSON, UTF-8 bytes). */
export const MAX_CONTROL_FRAME_BYTES = 16 * 1024;

/** Max serialized signaling WebSocket frame (JSON, UTF-8 bytes). SDP can be large. */
export const MAX_SIGNALING_FRAME_BYTES = 64 * 1024;

/** Max characters in one `text.insert` payload. Longer input must be chunked by the sender. */
export const MAX_TEXT_LENGTH = 2000;

/** Max |deltaX|/|deltaY| for a wheel event. */
export const MAX_WHEEL_DELTA = 10_000;

/** Max payload length for signaling display names. */
export const MAX_DISPLAY_NAME_LENGTH = 64;

/** Allowed id charset and bounds for device/session/pair/request ids. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Base64url (RFC 4648 §5, no padding) charset bounds for nonces/signatures/keys. */
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{2,}={0,2}$/;

/** Min entropy for peer challenge nonces: 16 bytes = 22 base64url chars. */
export const MIN_NONCE_LENGTH = 22;

/** Max nonce length: 64 bytes = 86 base64url chars. */
export const MAX_NONCE_LENGTH = 86;

/**
 * Key modifier bitmask shared by key.down/key.up.
 */
export const MODIFIER = {
  NONE: 0,
  CTRL: 1,
  ALT: 2,
  SHIFT: 4,
  META: 8,
} as const;
