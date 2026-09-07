import { ControlSender } from '@remotetab/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mode } from '../lib/gesture.ts';
import { PrioritizedInputSender } from '../lib/input-sender.ts';
import type { ReceiverSession, RemoteStatus } from '../lib/receiver-session.ts';
import { TouchBridge } from '../lib/touch-bridge.ts';
import { KeyboardSheet } from './KeyboardSheet.tsx';

/**
 * Viewer screen: remote video + connection status + input modes. Touch and
 * keyboard input (issue #011) only flow while the control channel is open.
 */
export function Viewer(props: {
  session: ReceiverSession | null;
  status: RemoteStatus;
  controlOpen: boolean;
  onDisconnect: () => void;
}) {
  const { session, status, controlOpen, onDisconnect } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<TouchBridge | null>(null);
  const [trackInfo, setTrackInfo] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<Mode>('pointer');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // One shared sender keeps touch + keyboard frames ordered end-to-end.
  const sender = useMemo(() => {
    if (!session) return null;
    const encodeWheel =
      (sessionId: string) => (d: { x: number; y: number; deltaX: number; deltaY: number }) => {
        const cs = new ControlSender(sessionId);
        return cs.wheel(d.x, d.y, Math.round(d.deltaX), Math.round(d.deltaY));
      };
    return new PrioritizedInputSender({
      send: (raw) => session.sendControl(raw),
      encodeWheel: (d) => {
        const sessionId = session.sessionId ?? '';
        return encodeWheel(sessionId)(d);
      },
    });
  }, [session]);

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

  // Attach the touch bridge once both video and wrap exist; re-arm on mode change.
  useEffect(() => {
    const video = videoRef.current;
    const wrap = wrapRef.current;
    if (!session || !video || !wrap) return;
    const bridge = new TouchBridge({
      element: wrap,
      video,
      session,
      mode,
      sender: sender ?? undefined,
    });
    bridgeRef.current = bridge;
    bridge.setChannelOpen(controlOpen);
    const dispose = bridge.attach();
    return () => {
      dispose();
      bridgeRef.current = null;
    };
  }, [session, mode, controlOpen, sender]);

  const onFullscreen = useCallback(() => {
    const el = wrapRef.current;
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

      <div className="video-wrap" ref={wrapRef}>
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
        <div className="modes" role="tablist" aria-label="Input mode">
          <button
            type="button"
            className={mode === 'pointer' ? 'mode selected' : 'mode'}
            onClick={() => setMode('pointer')}
          >
            Pointer
          </button>
          <button
            type="button"
            className={mode === 'scroll' ? 'mode selected' : 'mode'}
            onClick={() => setMode('scroll')}
          >
            Scroll
          </button>
        </div>
        <button
          type="button"
          className={keyboardOpen ? 'mode selected' : 'mode'}
          onClick={() => setKeyboardOpen((v) => !v)}
          aria-label="Keyboard"
        >
          ⌨
        </button>
        <button type="button" onClick={onFullscreen} aria-label="Fullscreen">
          ⛶
        </button>
        <details className="diag">
          <summary>Diag</summary>
          <code>
            phase: {status.phase}
            <br />
            control: {controlOpen ? 'open' : 'closed'}
            <br />
            mode: {mode}
            <br />
            video: {trackInfo ? `${trackInfo.w}×${trackInfo.h}` : '—'}
          </code>
        </details>
      </footer>

      {keyboardOpen && session && sender !== null && (
        <KeyboardSheet session={session} sender={sender} onClose={() => setKeyboardOpen(false)} />
      )}
    </main>
  );
}
