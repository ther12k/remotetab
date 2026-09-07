import { useCallback, useEffect, useRef, useState } from 'react';
import { decodePairingPayload, PairingSession } from '../lib/pairing.ts';
import { isBarcodeScanSupported, QrScanner } from '../lib/qr-scan.ts';

/**
 * Pairing screen (issue #013): scan the laptop's QR or paste the code.
 * On success the desktop is stored and the app jumps to Connect with the
 * laptop pre-filled.
 */
export function PairScreen(props: {
  server: string;
  onPaired: (desktopDeviceId: string) => void;
  onBack: () => void;
}) {
  const { server, onPaired, onBack } = props;
  const [rawCode, setRawCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const scanSupported = isBarcodeScanSupported();

  const settle = useCallback(
    (result: { ok: true; desktop: { deviceId: string } } | { ok: false; reason: string }) => {
      setBusy(false);
      setScanning(false);
      if (result.ok) {
        onPaired(result.desktop.deviceId);
      } else {
        setMessage(result.reason);
      }
    },
    [onPaired],
  );

  const pairWith = useCallback(
    (raw: string) => {
      const decoded = decodePairingPayload(raw);
      if (!decoded.ok) {
        setMessage(`That code is not a valid RemoteTab code (${decoded.reason}).`);
        return;
      }
      if (Date.now() >= decoded.value.expiresAtMs) {
        setMessage('That code expired. Generate a new one on the laptop.');
        return;
      }
      setBusy(true);
      setMessage(null);
      const session = new PairingSession({
        url: server.trim(),
        payload: decoded.value,
        onSettled: settle,
      });
      session.start();
    },
    [server, settle],
  );

  const startScan = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setScanning(true);
    setMessage(null);
    const scanner = new QrScanner();
    scannerRef.current = scanner;
    await scanner.start(
      video,
      (payload) => pairWith(payload),
      (message0) => {
        setScanning(false);
        setMessage(message0);
      },
    );
  }, [pairWith]);

  useEffect(() => () => scannerRef.current?.stop(), []);

  return (
    <main className="connect">
      <div className="brand">
        <img src="/icon.svg" alt="" width="44" height="44" />
        <h1>Pair a computer</h1>
      </div>

      {scanning ? (
        <div className="scan-wrap">
          <video ref={videoRef} playsInline muted className="scan-video" />
          <p className="muted">Point the camera at the laptop's QR code…</p>
        </div>
      ) : (
        <p className="lede">
          On the laptop, click <b>Pair phone…</b> in the RemoteTab popup, then scan the QR or paste
          the code here.
        </p>
      )}

      {scanSupported && !scanning && (
        <button type="button" className="primary" onClick={() => void startScan()}>
          Scan QR code
        </button>
      )}
      {scanning && (
        <button
          type="button"
          onClick={() => {
            scannerRef.current?.stop();
            setScanning(false);
          }}
        >
          Stop camera
        </button>
      )}

      {!scanning && (
        <>
          <label className="field">
            <span>Paste pairing code</span>
            <textarea
              className="bridge-area"
              rows={3}
              value={rawCode}
              onChange={(e) => setRawCode(e.target.value)}
              placeholder="RT1:…"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || rawCode.trim().length < 12}
            onClick={() => pairWith(rawCode.trim())}
          >
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </>
      )}

      {message !== null && <p className="notice">{message}</p>}

      <button type="button" className="ghost" onClick={onBack}>
        Back
      </button>
    </main>
  );
}
