/**
 * Client-side TURN helper (issue #017): turns a ws(s) signaling URL into its
 * http(s) origin, requests short-lived credentials bound to this device, and
 * merges them into the ICE server list. Best-effort by design — if the
 * endpoint is unavailable the session still works over STUN/direct.
 *
 * Requests are authenticated (#29): the device signs a canonical transcript
 * with its registered private key so a public deployment cannot be abused as
 * an open TURN credential mint.
 */

import { bytesToBase64url, encodeTranscript } from '@remotetab/crypto';
import { TURN_AUTH_DOMAIN } from '@remotetab/protocol';

export type TurnResponse = {
  ttlSeconds: number;
  username: string;
  credential: string;
  iceServers: { urls: string | string[]; username: string; credential: string }[];
};

function httpOriginFromWs(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'wss:') return `https://${parsed.host}`;
    if (parsed.protocol === 'ws:') return `http://${parsed.host}`;
    return null;
  } catch {
    return null;
  }
}

/** Device identity material used to sign the credential request (#29). */
export type TurnIdentity = {
  deviceId: string;
  privateKey: CryptoKey;
  publicKeySpki: string;
  publicKeyFingerprint: string;
};

/**
 * Fetch TURN ICE servers with a signed, device-bound request. Returns []
 * when TURN is unavailable/disabled — callers merge the result with their
 * STUN defaults and proceed.
 */
export async function fetchTurnIceServers(
  signalingUrl: string,
  identity: TurnIdentity,
  timeoutMs = 4000,
): Promise<{ urls: string | string[]; username: string; credential: string }[]> {
  const origin = httpOriginFromWs(signalingUrl);
  if (origin === null) return [];
  const timestamp = Date.now();
  let signature: string;
  try {
    signature = bytesToBase64url(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          identity.privateKey,
          encodeTranscript([TURN_AUTH_DOMAIN, '1', identity.deviceId, String(timestamp)]),
        ),
      ),
    );
  } catch {
    return []; // no usable signing key: proceed STUN-only
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/turn/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: identity.deviceId,
        timestamp,
        publicKeySpki: identity.publicKeySpki,
        publicKeyFingerprint: identity.publicKeyFingerprint,
        signature,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as Partial<TurnResponse>;
    if (!Array.isArray(body.iceServers)) return [];
    return body.iceServers.filter(
      (s): s is { urls: string | string[]; username: string; credential: string } =>
        (typeof s.urls === 'string' || Array.isArray(s.urls)) &&
        typeof s.username === 'string' &&
        typeof s.credential === 'string',
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Distinguish relay vs direct from a peer connection's stats (#019 builds on this). */
export type SelectedPair = {
  localType: string;
  remoteType: string;
  transport: 'relay' | 'direct' | 'unknown';
  rttMs: number | null;
};

export async function describeSelectedPair(pc: RTCPeerConnection): Promise<SelectedPair | null> {
  try {
    const stats = await pc.getStats();
    let pair: {
      localCandidateId?: string;
      remoteCandidateId?: string;
      currentRoundTripTime?: number;
    } | null = null;
    const candidates = new Map<string, { candidateType?: string }>();
    stats.forEach((report) => {
      if (
        report.type === 'candidate-pair' &&
        (report as { state?: string }).state === 'succeeded'
      ) {
        pair = report as {
          localCandidateId?: string;
          remoteCandidateId?: string;
          currentRoundTripTime?: number;
        };
      }
      if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
        const r = report as { id?: string; candidateType?: string };
        if (r.id) candidates.set(r.id, r);
      }
    });
    if (pair === null) return null;
    const p = pair as {
      localCandidateId?: string;
      remoteCandidateId?: string;
      currentRoundTripTime?: number;
    };
    const localType =
      (p.localCandidateId !== undefined
        ? candidates.get(p.localCandidateId)?.candidateType
        : undefined) ?? 'unknown';
    const remoteType =
      (p.remoteCandidateId !== undefined
        ? candidates.get(p.remoteCandidateId)?.candidateType
        : undefined) ?? 'unknown';
    return {
      localType,
      remoteType,
      rttMs:
        typeof p.currentRoundTripTime === 'number'
          ? Math.round(p.currentRoundTripTime * 1000)
          : null,
      transport: localType === 'relay' || remoteType === 'relay' ? 'relay' : 'direct',
    };
  } catch {
    return null;
  }
}
