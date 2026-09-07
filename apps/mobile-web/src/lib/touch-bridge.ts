/**
 * Touch bridge: glues viewer gestures (issue #010) to the prioritized input
 * sender. Coordinates are normalized against the RENDERED video rectangle
 * (letterbox-aware); letterbox and out-of-bounds touches are rejected.
 */

import { ControlSender, type ControlSender as ProtocolControlSender } from '@remotetab/protocol';
import { GestureClassifier, type Mode, type TouchPoint } from './gesture.ts';
import { PrioritizedInputSender, type SenderTimers } from './input-sender.ts';
import type { ReceiverSession } from './receiver-session.ts';
import { normalizePoint } from './video-rect.ts';

export class TouchBridge {
  private classifier: GestureClassifier;
  private sender: PrioritizedInputSender;
  private cleanupFns: (() => void)[] = [];
  private active = false;
  private ownsSender = false;

  constructor(
    private readonly opts: {
      element: HTMLElement;
      video: HTMLVideoElement;
      session: ReceiverSession;
      mode?: Mode;
      /** Shared sender (keyboard + touch share one ordering queue). */
      sender?: PrioritizedInputSender;
      moveIntervalMs?: number;
      wheelIntervalMs?: number;
      /** Pixels of finger travel mapped to one wheel notch step. */
      wheelScale?: number;
      timers?: SenderTimers;
    },
  ) {
    this.classifier = new GestureClassifier(opts.mode ?? 'pointer');
    this.sender = new PrioritizedInputSender({
      send: (raw) => this.opts.session.sendControl(raw),
      encodeWheel: (d) =>
        this.encode((s) => s.wheel(d.x, d.y, Math.round(d.deltaX), Math.round(d.deltaY))),
      moveIntervalMs: opts.moveIntervalMs,
      wheelIntervalMs: opts.wheelIntervalMs,
      timers: opts.timers,
    });
  }

  setMode(mode: Mode): void {
    this.classifier.setMode(mode);
  }

  /** Input only flows while the control channel is open (fail closed). */
  setChannelOpen(open: boolean): void {
    this.active = open;
    if (!open) {
      this.classifier.reset();
      // Never let a channel drop flush stale moves/clicks into a new session.
      this.sender.reset();
    }
  }

  attach(): () => void {
    const el = this.opts.element;
    const onDown = (ev: PointerEvent) => this.onDown(ev);
    const onMove = (ev: PointerEvent) => this.onMove(ev);
    const onUp = (ev: PointerEvent) => this.onUp(ev);
    const onCancel = () => this.classifier.reset();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    this.cleanupFns.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    });
    return () => {
      for (const fn of this.cleanupFns) fn();
      this.cleanupFns = [];
    };
  }

  private clientToVideoPoint(ev: PointerEvent): TouchPoint | null {
    const video = this.opts.video;
    const rect = video.getBoundingClientRect();
    const norm = normalizePoint(
      { x: ev.clientX, y: ev.clientY },
      {
        element: { width: rect.width, height: rect.height },
        video: { width: video.videoWidth, height: video.videoHeight },
      },
    );
    if (norm === null) return null; // letterbox / out of video: reject
    return { x: norm.x, y: norm.y, t: ev.timeStamp };
  }

  private onDown(ev: PointerEvent): void {
    if (!this.active) return;
    const point = this.clientToVideoPoint(ev);
    if (point === null) {
      this.classifier.reset();
      return;
    }
    ev.preventDefault();
    this.opts.element.setPointerCapture?.(ev.pointerId);
    this.classifier.pointerDown(point);
  }

  private onMove(ev: PointerEvent): void {
    if (!this.active) return;
    const point = this.clientToVideoPoint(ev);
    if (point === null) return; // finger over the letterbox: ignore sample
    const gesture = this.classifier.move(point);
    if (gesture === null) return;
    switch (gesture.kind) {
      case 'drag-start':
      case 'drag-move':
        this.sender.sendMove(this.encode((s) => s.pointerMove(point.x, point.y)));
        return;
      case 'wheel':
        this.sender.sendWheel({
          x: point.x,
          y: point.y,
          deltaX: gesture.deltaX * (this.opts.wheelScale ?? 2),
          deltaY: gesture.deltaY * (this.opts.wheelScale ?? 2),
        });
        return;
      default:
        return;
    }
  }

  private onUp(ev: PointerEvent): void {
    if (!this.active) return;
    const point = this.clientToVideoPoint(ev);
    if (point === null) return;
    const gesture = this.classifier.up(point);
    if (gesture === null) return;
    if (gesture.kind === 'tap') {
      // Flush a pending move so the click lands at a fresh position.
      this.sender.flushNow();
      this.sender.sendUrgent(
        this.encode((s) => s.pointerDown(point.x, point.y, 'left', gesture.clickCount)),
      );
      this.sender.sendUrgent(
        this.encode((s) => s.pointerUp(point.x, point.y, 'left', gesture.clickCount)),
      );
    }
  }

  private encode(build: (s: ProtocolControlSender) => string): string {
    const sessionId = this.opts.session.sessionId;
    if (sessionId === null) return '';
    return build(new ControlSender(sessionId));
  }

  dispose(): void {
    if (this.ownsSender) this.sender.dispose();
  }
}
