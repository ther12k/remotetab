/** RemoteTab wire protocol version. MVP supports only v1. */
export const PROTOCOL_VERSION = 1;

/** Domain separator prefix used in transcripts and ids. */
export const PROTOCOL_DOMAIN = 'remotetab.v1';

/** DataChannel name for reliable ordered control traffic. */
export const CONTROL_CHANNEL = 'control.v1';

/** DataChannel name for optional lossy health/RTT telemetry. */
export const HEALTH_CHANNEL = 'health.v1';
