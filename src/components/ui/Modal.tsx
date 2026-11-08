import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export interface ModalProps {
  labelledBy: string;
  describedBy?: string;
  /** Escape closes unless this is undefined (e.g. while busy). */
  onDismiss?: () => void;
  /** Receives focus on open; focus returns to the previous element on close. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/** Accessible modal shell: backdrop, focus trap over enabled buttons, Escape and focus restore. */
export function Modal({ labelledBy, describedBy, onDismiss, initialFocus, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current?.querySelector<HTMLElement>("button:not([disabled])"))?.focus();
    return () => prev?.focus?.();
    // Focus once per open; later re-renders must not steal focus back.
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && onDismiss) {
      e.stopPropagation();
      onDismiss();
      return;
    }
    if (e.key !== "Tab") return;
    const items = ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
    if (!items || items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5"
      >
        {children}
      </div>
    </div>
  );
}
