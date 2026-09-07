import { DEFAULT_ICE_SERVERS } from '@remotetab/webrtc';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from './components/Viewer.tsx';
import { loadPhoneIdentity } from './lib/phone-identity.ts';
import { ReceiverSession, type RemoteStatus } from './lib/receiver-session.ts';

type Screen = 'connect' | 'session';

const SERVER_KEY = 'remotetab.signalingUrl';
const CODE_KEY = 'remotetab.laptopCode';

function defaultServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? 'ws://localhost:8787/ws';
  } catch {
    return 'ws://localhost:8787/ws';
  }
}

export function App() {
  const identity = useMemo(() => loadPhoneIdentity(), []);
  const [screen, setScreen] = useState<Screen>('connect');
  const [code, setCode] = useState<string>(() => {
    try {
      return localStorage.getItem(CODE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [server, setServer] = useState<string>(defaultServerUrl);
  const [status, setStatus] = useState<RemoteStatus>({
    phase: 'idle',
    message: null,
    endedReason: null,
  });
  const sessionRef = useRef<ReceiverSession | null>(null);
  const [controlOpen, setControlOpen] = useState(false);

  const applyStatus = useCallback((next: RemoteStatus) => {
    setStatus(next);
    if (next.phase === 'ended') {
      setControlOpen(false);
      setScreen('connect');
      sessionRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const laptopCode = code.trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(laptopCode)) return;
    try {
      localStorage.setItem(CODE_KEY, laptopCode);
      localStorage.setItem(SERVER_KEY, server.trim());
    } catch {
      // private mode: code is kept in memory only
    }
    sessionRef.current?.disconnect();
    const session = new ReceiverSession({
      url: server.trim(),
      desktopDeviceId: laptopCode,
      identity,
      iceServers: DEFAULT_ICE_SERVERS, // TURN from the credential endpoint lands in #017
    });
    sessionRef.current = session;
    session.on('status', applyStatus);
    session.on('controlOpen', setControlOpen);
    session.connect();
    setScreen('session');
  }, [applyStatus, code, identity, server]);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setControlOpen(false);
    setScreen('connect');
  }, []);

  // Clean teardown when the app unmounts.
  useEffect(() => () => sessionRef.current?.disconnect(), []);

  if (screen === 'connect') {
    return (
      <ConnectScreen
        code={code}
        setCode={setCode}
        server={server}
        setServer={setServer}
        status={status}
        onConnect={connect}
      />
    );
  }

  const session = sessionRef.current;
  return (
    <Viewer session={session} status={status} controlOpen={controlOpen} onDisconnect={disconnect} />
  );
}

function ConnectScreen(props: {
  code: string;
  setCode: (v: string) => void;
  server: string;
  setServer: (v: string) => void;
  status: RemoteStatus;
  onConnect: () => void;
}) {
  const { code, setCode, server, setServer, status, onConnect } = props;
  const valid = /^[A-Za-z0-9_-]{8,64}$/.test(code.trim());
  const busy =
    status.phase === 'connecting' || status.phase === 'requesting' || status.phase === 'signaling';

  return (
    <main className="connect">
      <div className="brand">
        <img src="/icon.svg" alt="" width="56" height="56" />
        <h1>RemoteTab</h1>
      </div>

      <p className="lede">
        Enter this laptop's code from the RemoteTab popup. Your browser logins stay on the laptop —
        the phone only receives live video of one tab.
      </p>

      <label className="field">
        <span>Laptop code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="dev_…"
          enterKeyHint="go"
        />
      </label>

      <label className="field">
        <span>Server</span>
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          autoCapitalize="none"
          inputMode="url"
        />
      </label>

      {status.message !== null && <p className="notice">{status.message}</p>}

      <button type="button" className="primary" disabled={!valid || busy} onClick={onConnect}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>

      <details className="advanced">
        <summary>Connection status</summary>
        <code>{status.phase}</code>
      </details>
    </main>
  );
}
