import { type Bounds, boundsCenter } from '../core/geometry/bounds';
import { type Vec2, vec2 } from '../core/geometry/vector';

/**
 * View state. `cx`/`cy` is the world point at the centre of the viewport and
 * `zoom` is screen pixels per drawing unit. World Y points up, screen Y points down.
 */
export interface Camera {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
}

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

export const MIN_ZOOM = 1e-6;
export const MAX_ZOOM = 1e6;

export const DEFAULT_CAMERA: Camera = { cx: 0, cy: 0, zoom: 20 };

export function screenToWorld(cam: Camera, size: ViewSize, sx: number, sy: number): Vec2 {
  return vec2(cam.cx + (sx - size.width / 2) / cam.zoom, cam.cy - (sy - size.height / 2) / cam.zoom);
}

export function worldToScreen(cam: Camera, size: ViewSize, wx: number, wy: number): Vec2 {
  return vec2(size.width / 2 + (wx - cam.cx) * cam.zoom, size.height / 2 - (wy - cam.cy) * cam.zoom);
}

/** Moves the view so the drawing follows a pointer drag of (dxPx, dyPx) screen pixels. */
export function panByPixels(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { ...cam, cx: cam.cx - dxPx / cam.zoom, cy: cam.cy + dyPx / cam.zoom };
}

/** Zooms by `factor` while keeping the world point under the screen position fixed. */
export function zoomAtPixel(cam: Camera, size: ViewSize, sx: number, sy: number, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const anchor = screenToWorld(cam, size, sx, sy);
  return {
    cx: anchor.x - (sx - size.width / 2) / zoom,
    cy: anchor.y + (sy - size.height / 2) / zoom,
    zoom,
  };
}

/** Centres and scales the view so `bounds` fits with a margin in pixels. */
export function fitBounds(bounds: Bounds, size: ViewSize, marginPx = 40): Camera {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const usableW = Math.max(1, size.width - marginPx * 2);
  const usableH = Math.max(1, size.height - marginPx * 2);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(usableW / width, usableH / height)));
  const c = boundsCenter(bounds);
  return { cx: c.x, cy: c.y, zoom };
}

/** World-space rectangle currently visible in the viewport. */
export function visibleBounds(cam: Camera, size: ViewSize): Bounds {
  const a = screenToWorld(cam, size, 0, 0);
  const b = screenToWorld(cam, size, size.width, size.height);
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}
