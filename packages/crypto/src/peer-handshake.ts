/**
 * Mutual peer-authentication handshake (issue #014). Pure state machine:
 * crypto primitives and transport are injected as callbacks, so the same
 * class drives both laptop and phone.
 *
 * Flow (after the DataChannel opens):
 *   1. both sides immediately send their fresh challenge nonce;
 *   2. each side signs a canonical transcript binding session id, both
 *      device ids, both fingerprints, its OWN role, and the PEER's nonce;
 *   3. each side verifies the peer's signature against the stored peer key.
 *
 * Role reflection fails (a phone proof carries role "phone" — presenting it
 * as a desktop proof changes the transcript). Cross-session replay fails
 * (the session id and the peer's fresh nonce are bound). Control stays
 * disabled until `onVerified` fires; any failure/timeout calls `onFailed`.
 */

export type HandshakeRole = 'desktop' | 'phone';

export type HandshakeDeps = {
  role: HandshakeRole;
  protocolVersion: string;
  sessionId: string;
  myDeviceId: string;
  peerDeviceId: string;
  myFingerprint: string;
  peerFingerprint: string;
  /** Sign the canonical transcript bytes with THIS device's key → b64url. */
  sign: (transcript: Uint8Array<ArrayBuffer>) => Promise<string>;
  /** Verify the peer's signature over transcript bytes with the stored peer key. */
  verify: (transcript: Uint8Array<ArrayBuffer>, signatureB64: string) => Promise<boolean>;
  sendChallenge: (nonceB64: string) => void;
  sendProof: (signatureB64: string) => void;
  timeoutMs?: number;
  onTimeout?: () => void;
  /**random source: returns b64url nonce with ≥16 bytes entropy. */
  randomNonce?: () => string;
};

export type HandshakeOutcome = 'verified' | 'failed' | 'pending';

import { bytesToBase64url } from './b64.ts';
import { PEER_AUTH_DOMAIN as DOMAIN } from './challenge.ts';
import { randomBytes } from './random.ts';
import { encodeTranscript } from './transcript.ts';

export class PeerAuthHandshake {
  private myNonce: string | null = null;
  private peerNonce: string | null = null;
  private myProofSent = false;
  private peerProofVerified = false;
  private peerProofSig: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settled = false;

  constructor(private readonly deps: HandshakeDeps) {}

  start(): void {
    this.myNonce = bytesToBase64url(randomBytes(16));
    this.deps.sendChallenge(this.myNonce);
    const timeoutMs = this.deps.timeoutMs ?? 10_000;
    this.timer = setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.deps.onTimeout?.();
      }
    }, timeoutMs);
    // If the peer challenge already arrived (out-of-order delivery), proceed.
    void this.maybeProve();
  }

  /** Feed a peer.challenge frame payload. */
  onChallenge(nonceB64: string): void {
    if (this.settled) return;
    if (this.peerNonce !== null) return; // duplicate challenge: ignore
    this.peerNonce = nonceB64;
    void this.maybeProve();
  }

  /** Feed a peer.proof frame payload. Returns verification state. */
  async onProof(signatureB64: string): Promise<HandshakeOutcome> {
    if (this.settled) return 'failed';
    if (this.peerNonce === null || this.myNonce === null) {
      this.fail();
      return 'failed';
    }
    this.peerProofSig = signatureB64;
    const ok = await this.verifyPeer();
    if (!ok) {
      this.fail();
      return 'failed';
    }
    this.peerProofVerified = true;
    return this.maybeSettle();
  }

  /**
   * Canonical desktop-first field order (matches signPeerProof/verifyPeerProof):
   * [domain, version, sessionId, desktopDeviceId, phoneDeviceId,
   *  desktopFingerprint, phoneFingerprint, role, nonce]. Both sides MUST
   * build identical bytes for the same (role, nonce) or verification fails.
   */
  private transcript(role: HandshakeRole, nonce: string): Uint8Array<ArrayBuffer> {
    const amDesktop = this.deps.role === 'desktop';
    const desktopDeviceId = amDesktop ? this.deps.myDeviceId : this.deps.peerDeviceId;
    const phoneDeviceId = amDesktop ? this.deps.peerDeviceId : this.deps.myDeviceId;
    const desktopFingerprint = amDesktop ? this.deps.myFingerprint : this.deps.peerFingerprint;
    const phoneFingerprint = amDesktop ? this.deps.peerFingerprint : this.deps.myFingerprint;
    return encodeTranscript([
      DOMAIN,
      this.deps.protocolVersion,
      this.deps.sessionId,
      desktopDeviceId,
      phoneDeviceId,
      desktopFingerprint,
      phoneFingerprint,
      role,
      nonce,
    ]);
  }

  private async maybeProve(): Promise<void> {
    if (this.settled || this.myProofSent) return;
    if (this.peerNonce === null) return;
    this.myProofSent = true;
    const sig = await this.deps.sign(
      this.transcript(this.deps.role === 'desktop' ? 'desktop' : 'phone', this.peerNonce),
    );
    this.deps.sendProof(sig);
    // If the peer's proof arrived before we could verify (we had its nonce),
    // verify it now.
    if (this.peerProofSig !== null && !this.peerProofVerified) {
      await this.onProof(this.peerProofSig);
    }
  }

  private async verifyPeer(): Promise<boolean> {
    const peerRole: HandshakeRole = this.deps.role === 'desktop' ? 'phone' : 'desktop';
    if (this.myNonce === null || this.peerProofSig === null) return false;
    return this.deps.verify(this.transcript(peerRole, this.myNonce), this.peerProofSig);
  }

  private maybeSettle(): HandshakeOutcome {
    if (this.peerProofVerified && this.myProofSent) {
      this.settled = true;
      if (this.timer !== null) clearTimeout(this.timer);
      return 'verified';
    }
    return 'pending';
  }

  private fail(): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }
}
