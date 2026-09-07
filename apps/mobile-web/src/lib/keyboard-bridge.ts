/**
 * Keyboard bridge DOM layer (issue #011). Binds a local bridge textarea —
 * transport state only, cleared after sends; not a message history store.
 *
 * IME/composition behavior (documented, not silently corrupted):
 *  - while composing, per-key events are suppressed;
 *  - on compositionend the FINAL committed string is sent as text.insert;
 *  - live composition text is not mirrored mid-composition.
 * Emoji are supported through text.insert (surrogate-pair-safe protocol).
 */

import type { PrioritizedInputSender } from './input-sender.ts';
import { mapControlKey, splitTextChunks } from './keyboard.ts';
import type { ReceiverSession } from './receiver-session.ts';

const CHUNK = 500;

export class KeyboardBridge {
  private composing = false;
  private cleanup: (() => void) | null = null;

  constructor(
    private readonly opts: {
      session: ReceiverSession;
      sender: PrioritizedInputSender;
      /** Called after any send so the UI can clear the bridge field. */
      onSent?: () => void;
    },
  ) {}

  bind(textarea: HTMLTextAreaElement): () => void {
    this.unbind();
    const onKeyDown = (ev: Event) => this.onKeyDown(ev as KeyboardEvent, textarea);
    const onBeforeInput = (ev: Event) => this.onBeforeInput(ev as InputEvent);
    const onCompositionStart = () => {
      this.composing = true;
    };
    const onCompositionEnd = (ev: Event) => {
      this.composing = false;
      const e = ev as CompositionEvent;
      if (e.data) this.sendText(e.data);
    };

    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('beforeinput', onBeforeInput);
    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionend', onCompositionEnd);
    this.cleanup = () => {
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('beforeinput', onBeforeInput);
      textarea.removeEventListener('compositionstart', onCompositionStart);
      textarea.removeEventListener('compositionend', onCompositionEnd);
    };
    return () => this.unbind();
  }

  unbind(): void {
    this.cleanup?.();
    this.cleanup = null;
  }

  private onKeyDown(ev: KeyboardEvent, textarea: HTMLTextAreaElement): void {
    if (this.composing || ev.isComposing) return;
    const control = mapControlKey(ev);
    if (control !== null) {
      ev.preventDefault();
      this.sendKey(control);
      if (ev.key === 'Enter') textarea.value = '';
      return;
    }
    if (ev.key.length === 1 && (ev.ctrlKey || ev.metaKey || ev.altKey)) {
      // Modifier combos are NOT synthesized locally — the browser's own
      // behavior differs per platform; forward as-is (insertText path will
      // carry printable results).
      return;
    }
  }

  private onBeforeInput(ev: InputEvent): void {
    if (this.composing || ev.isComposing) return;
    switch (ev.inputType) {
      case 'insertText':
      case 'insertCompositionText':
        if (ev.data && ev.data.length > 0) {
          ev.preventDefault();
          this.sendText(ev.data);
        }
        return;
      case 'deleteContentBackward': {
        ev.preventDefault();
        const control = mapControlKey({ key: 'Backspace', code: 'Backspace' });
        if (control) this.sendKey(control);
        return;
      }
      case 'deleteContentForward': {
        ev.preventDefault();
        const control = mapControlKey({ key: 'Delete', code: 'Delete' });
        if (control) this.sendKey(control);
        return;
      }
      default:
        return; // paste/undo/etc. flow through the textarea value below
    }
  }

  /** Channel dropped: drop queued keystrokes so nothing replays later. */
  reset(): void {
    this.opts.sender.reset();
  }

  /** Send text as bounded chunks (also used by the sheet's Send button). */
  sendText(text: string): void {
    if (text.length === 0) return;
    for (const chunk of splitTextChunks(text, CHUNK)) {
      this.opts.sender.sendUrgent(this.encode((s) => s.insertText(chunk)));
    }
    this.opts.onSent?.();
  }

  sendKey(control: NonNullable<ReturnType<typeof mapControlKey>>): void {
    this.opts.sender.sendUrgent(
      this.encode((s) => s.keyDown(control.key, control.code, control.modifiers)),
    );
    this.opts.sender.sendUrgent(
      this.encode((s) => s.keyUp(control.key, control.code, control.modifiers)),
    );
  }

  /** Convenience for on-screen quick keys. */
  sendQuickKey(
    key: 'Escape' | 'Tab' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter',
    mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
  ): void {
    const control = mapControlKey({ key, code: key, ...mods });
    if (control) this.sendKey(control);
  }

  private encode(build: Parameters<ReceiverSession['sendControlFrame']>[0]): string {
    return build(makeEncoder(this.opts.session));
  }

  dispose(): void {
    this.unbind();
  }
}

import { ControlSender } from '@remotetab/protocol';

function makeEncoder(session: ReceiverSession): ControlSender {
  return new ControlSender(session.sessionId ?? 'sess_nonexistent0000000001');
}
