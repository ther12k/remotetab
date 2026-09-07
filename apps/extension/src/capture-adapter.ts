/**
 * Selected-tab capture adapter running inside the offscreen document
 * (ADR-013). The MV3 service worker cannot host media; the popup obtains the
 * tabCapture streamId in the user-gesture context, and this adapter consumes
 * it with getUserMedia. Stop() must end EVERY track (release blocker).
 */

export type CaptureState = 'idle' | 'starting' | 'active' | 'error';

export interface TabCaptureAdapter {
  /** Consume a tabCapture streamId obtained by the popup user gesture. */
  start(streamId: string): Promise<{ width: number; height: number } | null>;
  stop(): Promise<void>;
  state(): CaptureState;
  /** Register a callback fired when the underlying track ends by itself. */
  onEnded(listener: () => void): void;
}

export class OffscreenTabCaptureAdapter implements TabCaptureAdapter {
  private stream: MediaStream | null = null;
  private currentState: CaptureState = 'idle';
  private endedListeners: (() => void)[] = [];

  state(): CaptureState {
    return this.currentState;
  }

  onEnded(listener: () => void): void {
    this.endedListeners.push(listener);
  }

  async start(streamId: string): Promise<{ width: number; height: number } | null> {
    if (this.currentState === 'starting') {
      throw new Error('capture start already in progress');
    }
    if (this.currentState === 'active') {
      throw new Error('capture already active — stop it first');
    }
    this.currentState = 'starting';
    try {
      // chromeMediaSource constraints are Chrome-only and outside the TS DOM lib.
      const constraints = {
        audio: false, // ADR-010: no audio in the MVP.
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
            maxFrameRate: 15,
          },
        },
      } as unknown as MediaStreamConstraints;
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error('capture stream has no video track');
      track.addEventListener('ended', () => {
        this.stream = null;
        this.currentState = 'idle';
        for (const listener of this.endedListeners) listener();
      });
      this.currentState = 'active';
      const settings = track.getSettings();
      return { width: settings.width ?? 0, height: settings.height ?? 0 };
    } catch (err) {
      this.currentState = 'error';
      throw new Error(mapCaptureError(err), { cause: err });
    }
  }

  async stop(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    this.currentState = 'idle';
  }
}

/**
 * Map getUserMedia failures to short, user-readable causes. Never echo raw
 * exception text into UI.
 */
export function mapCaptureError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Capture was not permitted for this tab.';
    case 'NotFoundError':
      return 'No capturable video source was found for this tab.';
    case 'AbortError':
      return 'Capture could not start for this tab.';
    default:
      return 'Capture could not start for this tab.';
  }
}
