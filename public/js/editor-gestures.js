/* Touch gestures for the photo editor's Fabric canvas. The vendored Fabric build has no gestures
 * module, so two-finger pinch/rotate and double-tap-to-delete are implemented here. */
(function () {
  'use strict';

  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_SLOP_PX = 30;
  const MIN_SCALE_FALLBACK = 0.01;

  const span = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const turn = (a, b) => (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
  const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  /** Double-tap a prop to delete it (Fabric's dblclick is unreliable on touch screens). */
  function attachDoubleTap(canvas, onChange, canDelete) {
    let last = null;
    canvas.on('mouse:down', (opt) => {
      const { target, pointer: p } = opt;
      const now = Date.now();
      if (target && canDelete(target) && last && last.target === target && now - last.time < DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_TAP_SLOP_PX) {
        last = null;
        canvas.discardActiveObject();
        canvas.remove(target);
        canvas.requestRenderAll();
        if (navigator.vibrate) navigator.vibrate(20);
        onChange(null);
        return;
      }
      last = { target, time: now, x: p.x, y: p.y };
    });
  }

  /**
   * Two-finger pinch + rotate on the active prop (or the prop under the fingers).
   * Capture-phase listeners keep Fabric from seeing the moves while two fingers are down, and keep
   * blocking until every finger lifts so the remaining finger does not make the prop jump.
   */
  function attachPinch(canvas, stage, onChange) {
    let g = null;

    function targetAt(point) {
      const active = canvas.getActiveObject();
      if (active) return active;
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const pt = new fabric.Point(point.x - rect.left, point.y - rect.top);
      return canvas.getObjects().slice().reverse().find((o) => o.visible && o.evented && o.containsPoint(pt)) || null;
    }

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const target = targetAt(mid(a, b));
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      canvas.setActiveObject(target);
      g = {
        target, active: true, d0: Math.max(1, span(a, b)), a0: turn(a, b), m0: mid(a, b),
        scaleX: target.scaleX, scaleY: target.scaleY, angle: target.angle, center: target.getCenterPoint(),
      };
    }, { capture: true, passive: false });

    stage.addEventListener('touchmove', (e) => {
      if (!g) return;
      e.preventDefault();
      e.stopPropagation();
      if (!g.active || e.touches.length < 2) return;
      const [a, b] = e.touches;
      const minScale = g.target.minScaleLimit || MIN_SCALE_FALLBACK;
      const k = Math.max(minScale / g.scaleX, span(a, b) / g.d0);
      const m = mid(a, b);
      g.target.set({ scaleX: g.scaleX * k, scaleY: g.scaleY * k, angle: g.angle + turn(a, b) - g.a0 });
      g.target.setPositionByOrigin(new fabric.Point(g.center.x + m.x - g.m0.x, g.center.y + m.y - g.m0.y), 'center', 'center');
      g.target.setCoords();
      canvas.requestRenderAll();
    }, { capture: true, passive: false });

    const end = (e) => {
      if (!g) return;
      if (g.active && e.touches.length < 2) {
        g.active = false;
        onChange(g.target);
      }
      if (e.touches.length === 0) g = null;
    };
    stage.addEventListener('touchend', end, { capture: true });
    stage.addEventListener('touchcancel', end, { capture: true });
    stage.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /**
   * `onChange(target)` is called after every completed gesture (target = the pinched object, or null
   * after a delete) so the editor can record undo history. `canDelete(target)` guards double-tap delete.
   */
  function attach(canvas, stage, { onChange, canDelete = () => true }) {
    attachDoubleTap(canvas, onChange, canDelete);
    attachPinch(canvas, stage, onChange);
  }

  window.EditorGestures = { attach };
})();
