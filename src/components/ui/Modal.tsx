import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export interface ModalProps {
  labelledBy: string;
  describedBy?: string;
  /** Escape and a backdrop click close unless this is undefined (e.g. while busy). */
  onDismiss?: () => void;
  /** Receives focus on open; focus returns to the previous element on close. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** "sheet" slides up from the bottom on phones and is centered on wider screens. */
  variant?: "dialog" | "sheet";
  children: ReactNode;
}

/** Accessible modal shell: backdrop, focus trap, Escape and focus restore. */
export function Modal({ labelledBy, describedBy, onDismiss, initialFocus, variant = "dialog", children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current?.querySelector<HTMLElement>("button:not([disabled]), input"))?.focus();
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
    const items = ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])");
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

  const sheet = variant === "sheet";
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-paper/85 ${sheet ? "items-end sm:items-center sm:p-4" : "items-center p-4"}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        className={`w-full border border-border bg-surface p-5 shadow-2xl ${
          sheet ? "max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:max-w-md sm:rounded-3xl" : "max-w-sm rounded-2xl"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
