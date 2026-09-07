/**
 * Rendered-video rectangle math (issue #010 acceptance: "Viewer exposes
 * measurable rendered-content rectangle for coordinate mapping").
 *
 * The phone sends normalized coordinates in [0..1] relative to the VIDEO
 * CONTENT, not the <video> element. When the element's aspect ratio differs
 * from the video's intrinsic ratio, `object-fit: contain` letterboxes the
 * content; taps on the letterbox must be rejected.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type VideoGeometry = {
  /** Element box in client pixels (getBoundingClientRect). */
  element: { width: number; height: number };
  /** Intrinsic video size from the track/element. */
  video: { width: number; height: number };
};

/**
 * Compute the letterboxed content rectangle inside the element box.
 * Returns null when either dimension is non-positive.
 */
export function contentRect(geometry: VideoGeometry): Rect | null {
  const { element, video } = geometry;
  if (element.width <= 0 || element.height <= 0 || video.width <= 0 || video.height <= 0) {
    return null;
  }
  const elementRatio = element.width / element.height;
  const videoRatio = video.width / video.height;
  if (elementRatio === videoRatio) {
    return { x: 0, y: 0, width: element.width, height: element.height };
  }
  if (elementRatio > videoRatio) {
    // Element is wider: vertical letterbox bars top/bottom.
    const height = element.height;
    const width = height * videoRatio;
    return { x: (element.width - width) / 2, y: 0, width, height };
  }
  // Element is taller: horizontal bars left/right.
  const width = element.width;
  const height = width / videoRatio;
  return { x: 0, y: (element.height - height) / 2, width, height };
}

export type Normalized = { x: number; y: number };

/**
 * Map a client-space point to normalized video coordinates [0..1].
 * Returns null for letterbox/out-of-bounds taps (caller must reject).
 */
export function normalizePoint(
  point: { x: number; y: number },
  geometry: VideoGeometry,
  rect: Rect | null = contentRect(geometry),
): Normalized | null {
  if (!rect) return null;
  const nx = (point.x - rect.x) / rect.width;
  const ny = (point.y - rect.y) / rect.height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  // Small tolerance so edge pixels still hit; beyond that it's the letterbox.
  const eps = 0.001;
  if (nx < -eps || nx > 1 + eps || ny < -eps || ny > 1 + eps) return null;
  return { x: clamp01(nx), y: clamp01(ny) };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Map normalized coordinates to target CSS pixels (laptop side mirrors this). */
export function denormalize(
  norm: Normalized,
  targetCss: { width: number; height: number },
): { x: number; y: number } {
  return { x: norm.x * targetCss.width, y: norm.y * targetCss.height };
}
