export {
  base64urlToBytes,
  bytesToBase64url,
  bytesToUtf8,
  toHex,
  utf8ToBytes,
} from './b64.ts';
export {
  CHALLENGE_NONCE_BYTES,
  generateChallengeNonce,
  PEER_AUTH_DOMAIN,
  type PeerProofTranscript,
  signPeerProof,
  verifyPeerProof,
} from './challenge.ts';
export {
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
  generateSigningKeyPair,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  KEY_ALG,
  keyFingerprint,
  type SigningKeyPair,
} from './keys.ts';
export {
  generatePairingNonce,
  generatePairingSecret,
  PAIRING_DOMAIN,
  PAIRING_NONCE_BYTES,
  PAIRING_SECRET_BYTES,
  type PairingTranscript,
  pairingProof,
  verifyPairingProof,
} from './pairing.ts';
export {
  decodePairingPayload,
  encodePairingPayload,
  type PairingPayloadV1,
} from './pairing-payload.ts';
export {
  type HandshakeDeps,
  type HandshakeOutcome,
  type HandshakeRole,
  PeerAuthHandshake,
} from './peer-handshake.ts';
export { randomBytes, timingSafeEqual } from './random.ts';
export { encodeTranscript } from './transcript.ts';
