import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReceiverSession, RemoteStatus } from '../lib/receiver-session.ts';

/**
 * Viewer screen: remote video + connection status chip. Input gestures
 * (touch/keyboard) arrive with issues #010/#011 — this issue establishes the
 * measurable rendered-content rectangle they depend on.
 */
export function Viewer(props: {
  session: ReceiverSession | null;
  status: RemoteStatus;
  controlOpen: boolean;
  onDisconnect: () => void;
}) {
  const { session, status, controlOpen, onDisconnect } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [trackInfo, setTrackInfo] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    const off = session.on('track', (track) => {
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = new MediaStream([track]);
      void video.play().catch(() => {
        // Autoplay can require a user gesture; the connect button counts.
      });
      const settings = track.getSettings();
      setTrackInfo({ w: settings.width ?? 0, h: settings.height ?? 0 });
    });
    return off;
  }, [session]);

  const onFullscreen = useCallback(() => {
    const el = videoRef.current?.parentElement;
    if (el && document.fullscreenEnabled) {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const chip =
    status.phase === 'active' || controlOpen
      ? { text: 'Live', cls: 'ok' }
      : status.phase === 'peer-connected' || status.phase === 'signaling'
        ? { text: 'Starting…', cls: 'wait' }
        : status.phase === 'reconnecting'
          ? { text: 'Reconnecting…', cls: 'wait' }
          : { text: status.phase, cls: '' };

  return (
    <main className="viewer">
      <header>
        <span className={`chip ${chip.cls}`}>{chip.text}</span>
        <button type="button" className="ghost" onClick={onDisconnect}>
          Disconnect
        </button>
      </header>

      <div className="video-wrap">
        <video ref={videoRef} playsInline autoPlay muted className="remote-video" />
        {status.phase === 'reconnecting' && (
          <div className="overlay">
            <p>{status.message ?? 'Reconnecting…'}</p>
            <p className="sub">Remote input paused.</p>
          </div>
        )}
        {status.message !== null && status.phase !== 'reconnecting' && (
          <div className="overlay">
            <p>{status.message}</p>
          </div>
        )}
      </div>

      <footer>
        <button type="button" onClick={onFullscreen}>
          Fullscreen
        </button>
        <details className="diag">
          <summary>Diagnostics</summary>
          <code>
            phase: {status.phase}
            <br />
            control: {controlOpen ? 'open' : 'closed'}
            <br />
            video: {trackInfo ? `${trackInfo.w}×${trackInfo.h}` : '—'}
          </code>
        </details>
      </footer>
    </main>
  );
}
