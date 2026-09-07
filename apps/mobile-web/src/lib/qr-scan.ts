/**
 * QR scanning via the platform BarcodeDetector (Android Chrome). When
 * unavailable, the UI falls back to pasting the code manually — no tracking
 * libraries, no remote code.
 */

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

export function isBarcodeScanSupported(): boolean {
  return detectorCtor() !== null;
}

export class QrScanner {
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(
    video: HTMLVideoElement,
    onResult: (payload: string) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    const Ctor = detectorCtor();
    if (!Ctor) {
      onError('This browser cannot scan QR codes. Paste the pairing code instead.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch {
      onError('Camera access was denied. Paste the pairing code instead.');
      return;
    }
    video.srcObject = this.stream;
    void video.play().catch(() => undefined);
    const detector = new Ctor({ formats: ['qr_code'] });
    const canvas = document.createElement('canvas');
    const tick = async () => {
      if (video.readyState < 2 || video.videoWidth === 0) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      try {
        const codes = await detector.detect(canvas);
        for (const code of codes) {
          if (code.rawValue) {
            this.stop();
            onResult(code.rawValue);
            return;
          }
        }
      } catch {
        // transient decode failure — keep scanning
      }
    };
    this.timer = setInterval(() => void tick(), 250);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}
