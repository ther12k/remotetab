/**
 * ICE server configuration helpers. Clients receive server URLs/credentials
 * from the signaling service (#017); static TURN secrets never ship in code.
 */

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

/** Convert a list of `stun:`/`turn:`/`turns:` URL strings into RTCIceServer entries. */
export function toIceServers(urls: string[]): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun: string[] = [];
  const turn: string[] = [];
  for (const url of urls) {
    if (url.startsWith('stun:')) stun.push(url);
    else if (url.startsWith('turn:') || url.startsWith('turns:')) turn.push(url);
  }
  if (stun.length > 0) servers.push({ urls: stun });
  // TURN credentials arrive per-session from the credential endpoint (#017).
  if (turn.length > 0) servers.push({ urls: turn });
  return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
}
