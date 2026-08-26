import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { registerOverlay } from "@/lib/overlay-registry";
import { useKeyboard } from "@/hooks/use-keyboard";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  /** Classes applied to the modal panel. */
  className?: string;
  /** Classes applied to the backdrop. */
  backdropClassName?: string;
  /** Align the panel near the top instead of centered (search modals). */
  alignTop?: boolean;
  /** Close when the user taps the blurred backdrop. Default true. */
  closeOnBackdrop?: boolean;
  /** Render children inside a <form>-friendly wrapper? (no-op; kept for API stability) */
  labelledBy?: string;
}

/**
 * App-wide modal / dialog / bottom-sheet shell.
 *
 * - Always renders a blurred backdrop (never a plain dark overlay).
 * - Registers itself in the global overlay registry so the Bottom Navigation
 *   hides while the modal is open (and never renders above/behind it).
 * - The panel ALWAYS fits its content: it is capped to the padded overlay
 *   height (max-h-full, no fragile viewport units) so there is never an
 *   empty white area below the content and never an oversized panel.
 * - Centered, keyboard-safe (moves above the on-screen keyboard and scrolls),
 * - Closes on Escape, z-index above all app UI.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  backdropClassName,
  alignTop = false,
  closeOnBackdrop = true,
}: ModalProps) {
  const { isKeyboardOpen: keyboardOpen } = useKeyboard();
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  // Register in the global overlay registry for the whole lifetime of the modal
  useEffect(() => {
    if (!open) return;
    return registerOverlay();
  }, [open]);

  // Keep track of viewport height when open
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setViewportHeight(vv.height);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the modal is open without triggering layout reflow
  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    const originalOverscroll = document.body.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.overscrollBehavior = originalOverscroll;
    };
  }, [open]);

  if (!open) return null;

  const panelStyle =
    keyboardOpen && viewportHeight
      ? { maxHeight: `${Math.max(160, viewportHeight - 24)}px` }
      : undefined;

  const overlay = (
    <div
      className={cn(
        "fixed inset-0 h-viewport z-[80] grid bg-black/50 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xs transform-gpu will-change-[opacity] overscroll-contain",
        alignTop
          ? "items-start justify-center pt-[calc(4rem+env(safe-area-inset-top))]"
          : keyboardOpen
            ? "items-end justify-center pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
            : "items-center justify-center",
        backdropClassName,
      )}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      {/*
        Panel sizing:
        - `max-h-full` caps the panel to the overlay's padded area on EVERY
          device (no dvh/vh support needed) so it can never overflow the
          screen or leave blank space below the content.
        - `min-h-0` + `overflow-y-auto` lets the panel scroll internally when
          content is taller than the screen.
        - No explicit height is ever set, so the panel height is always
          exactly its content height (shorter content → snug fit).
      */}
      <div
        role="dialog"
        aria-modal="true"
        style={panelStyle}
        className={cn(
          // Shared responsive sizing for EVERY dialog:
          //   mobile  → 92vw wide, capped at 420px
          //   tablet  → capped at 500px (≥640px viewport)
          //   desktop → capped at 560px (≥768px viewport)
          "relative z-[90] w-[92vw] max-w-[420px] min-h-0 max-h-full overflow-y-auto overscroll-contain rounded-3xl bg-white p-6 shadow-2xl",
          "animate-in zoom-in-95 fade-in-0 duration-200 transform-gpu will-change-[transform,opacity]",
          "sm:max-w-[500px] md:max-w-[560px]",
          // Ensure scrollable content never hides behind safe-area or keyboard
          "max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );

  // Render through a portal onto <body> so the overlay is positioned against
  // the real viewport. Without this, the page container's `will-change`/
  // transform (used by the page fade animation) becomes the containing block
  // for `position: fixed`, so after the page is scrolled the dialog gets
  // dragged along with the content and leaves a white gap at the bottom.
  return createPortal(overlay, document.body);
}
