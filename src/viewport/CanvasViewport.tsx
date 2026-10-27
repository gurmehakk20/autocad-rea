import { useEffect, useRef } from 'react';
import type { Vec2 } from '../core/geometry/vector';
import { session } from '../state/session';
import { Renderer } from './Renderer';

/** Converts a mouse event to canvas-local CSS pixels. */
function localPoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/**
 * Drawing surface. Rendering runs through `requestAnimationFrame` and reads the
 * session's view channel, so React does not re-render during pointer movement.
 */
export function CanvasViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = canvas.parentElement!;
    const renderer = new Renderer(canvas);
    let frame = 0;

    const draw = () => {
      frame = 0;
      renderer.draw(session.renderState());
    };
    const scheduleDraw = () => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const size = renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      session.setViewSize(size.width, size.height);
      scheduleDraw();
    };

    const unsubscribe = session.subscribeView(scheduleDraw);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const onMove = (e: PointerEvent) => session.pointerMove(localPoint(canvas, e));
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      session.pointerDown(localPoint(canvas, e), e.button, e.shiftKey);
    };
    const onUp = (e: PointerEvent) => session.pointerUp(localPoint(canvas, e));
    const onLeave = () => session.pointerLeave();
    const onCancel = () => session.pointerCancel();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode 1 is lines and 2 is pages (common in Firefox). Convert to approximate pixels.
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      session.wheel(localPoint(canvas, e), pixels);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    // Browser zoom changes the device pixel ratio without resizing the container.
    window.addEventListener('resize', resize);

    return () => {
      unsubscribe();
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} className="viewport-canvas" aria-label="Drawing canvas" />
    </div>
  );
}
