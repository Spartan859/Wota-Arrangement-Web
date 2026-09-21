import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** One pointer session. Always remove listeners before committing/releasing capture. */
export function usePointerDrag(resetKey: string, disabled: boolean) {
  const active = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      active.current?.();
    },
    [resetKey, disabled],
  );
  return (
    event: ReactPointerEvent<Element>,
    move: (event: PointerEvent) => void,
    done: (cancelled: boolean) => void,
  ) => {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    active.current?.();
    const element = event.currentTarget;
    const id = event.pointerId;
    const doc = element.ownerDocument;
    const win = doc.defaultView!;
    let finished = false;
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      win.removeEventListener("pointermove", onMove, true);
      win.removeEventListener("pointerup", onUp, true);
      win.removeEventListener("pointercancel", onCancel, true);
      win.removeEventListener("blur", abort);
      doc.removeEventListener("visibilitychange", hidden);
      element.removeEventListener("lostpointercapture", onLostCapture);
      element.removeEventListener("dragstart", preventDrag);
      active.current = null;
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      done(cancelled);
    };
    const abort = () => finish(true);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!element.isConnected) {
        abort();
        return;
      }
      // Recover when pointerup was lost outside the window; don't move to a new point.
      if ((e.buttons & 1) === 0) {
        finish(false);
        return;
      }
      move(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === id) finish(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === id) abort();
    };
    // Losing capture only changes the event target. Window listeners still own
    // this drag until pointerup, cancellation, or a move with no button pressed.
    const onLostCapture = () => {
      if (!element.isConnected) abort();
    };
    const hidden = () => {
      if (doc.visibilityState === "hidden") abort();
    };
    const preventDrag = (e: Event) => e.preventDefault();
    active.current = abort;
    win.addEventListener("pointermove", onMove, true);
    win.addEventListener("pointerup", onUp, true);
    win.addEventListener("pointercancel", onCancel, true);
    win.addEventListener("blur", abort);
    doc.addEventListener("visibilitychange", hidden);
    element.addEventListener("lostpointercapture", onLostCapture);
    element.addEventListener("dragstart", preventDrag);
    try {
      element.setPointerCapture(id);
    } catch {
      abort();
    }
  };
}
