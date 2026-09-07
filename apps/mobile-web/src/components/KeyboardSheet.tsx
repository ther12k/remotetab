import { useEffect, useRef } from 'react';
import type { PrioritizedInputSender } from '../lib/input-sender.ts';
import { KeyboardBridge } from '../lib/keyboard-bridge.ts';
import type { ReceiverSession } from '../lib/receiver-session.ts';

const QUICK_KEYS = [
  { key: 'Escape', label: 'Esc' },
  { key: 'Tab', label: 'Tab' },
  { key: 'ArrowUp', label: '↑' },
  { key: 'ArrowDown', label: '↓' },
  { key: 'ArrowLeft', label: '←' },
  { key: 'ArrowRight', label: '→' },
  { key: 'Enter', label: 'Enter' },
] as const;

/**
 * Bottom-sheet keyboard bridge (UX_FLOWS.md). The textarea is transport
 * state: it is cleared after Enter/send and never stores history. Text typed
 * here lands in whatever element the user focused on the remote tab.
 */
export function KeyboardSheet(props: {
  session: ReceiverSession;
  sender: PrioritizedInputSender;
  onClose: () => void;
}) {
  const { session, sender, onClose } = props;
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const bridgeRef = useRef<KeyboardBridge | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const bridge = new KeyboardBridge({
      session,
      sender,
      onSent: () => {
        // Transport state only: keep the local mirror short.
        if (area.value.length > 1000) area.value = '';
      },
    });
    bridgeRef.current = bridge;
    const unbind = bridge.bind(area);
    area.focus();
    return () => {
      unbind();
      bridge.dispose();
    };
  }, [session, sender]);

  const sendNow = () => {
    const area = areaRef.current;
    const bridge = bridgeRef.current;
    if (!area || !bridge || area.value.length === 0) return;
    bridge.sendText(area.value);
    area.value = '';
  };

  return (
    <div className="sheet" role="dialog" aria-label="Remote keyboard">
      <div className="sheet-bar">
        <span className="muted">Type to the remote focus…</span>
        <button type="button" className="ghost" onClick={onClose}>
          Close keyboard
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="bridge-area"
        placeholder="Text lands in the focused remote element"
        rows={2}
        autoCapitalize="sentences"
      />
      <div className="quick-keys">
        {QUICK_KEYS.map((q) => (
          <button
            key={q.key}
            type="button"
            className="quick"
            onClick={() => bridgeRef.current?.sendQuickKey(q.key)}
          >
            {q.label}
          </button>
        ))}
        <button type="button" className="quick send" onClick={sendNow}>
          Send text
        </button>
      </div>
    </div>
  );
}
