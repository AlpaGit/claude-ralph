import {
  useEffect,
  useRef,
  useCallback,
  type JSX,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import styles from "./UModal.module.css";

/* ── Public types ──────────────────────────────────────── */

export interface UModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the modal requests to close (backdrop click, Escape, close button). */
  onClose: () => void;
  /** Optional heading rendered in the modal header. */
  title?: string;
  /** Modal body content. */
  children: ReactNode;
  /** Optional footer content (e.g. action buttons). Rendered below a dashed separator. */
  footer?: ReactNode;
  /** Additional CSS class name appended to the dialog element. */
  className?: string;
}

export interface UConfirmModalProps {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the user cancels (backdrop click, Escape, cancel button). */
  onCancel: () => void;
  /** Called when the user confirms. */
  onConfirm: () => void;
  /** Optional heading. Defaults to "Confirm". */
  title?: string;
  /** Body content describing what the user is confirming. */
  children: ReactNode;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Whether the confirm action is in-progress (shows loading state). */
  loading?: boolean;
  /** Visual style for the confirm button. Defaults to "primary". */
  confirmVariant?: "primary" | "danger";
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Returns the portal container element, creating it on first call.
 * Appended to document.body so modals render outside the React tree.
 */
function getPortalRoot(): HTMLElement {
  let el = document.getElementById("u-modal-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "u-modal-root";
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Returns all focusable elements inside a container.
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

/* ── UModal component ─────────────────────────────────── */

export function UModal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: UModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /* Focus the dialog on open; restore focus on close */
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Small delay to let the portal render before focusing
      const timer = setTimeout(() => {
        dialogRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  /* Lock body scroll while open */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* Handle Escape key and focus trap */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  /* Close on backdrop click (not dialog click) */
  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!open) return null;

  const dialogClass = cn(styles.dialog, className);

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        className={dialogClass}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Dialog"}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className={styles.header}>
          {title ? <h2 className={styles.title}>{title}</h2> : <span />}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close dialog"
          >
            &#x2715;
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>{children}</div>

        {/* Footer */}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    getPortalRoot()
  );
}

/* ── UConfirmModal convenience wrapper ────────────────── */

export function UConfirmModal({
  open,
  onCancel,
  onConfirm,
  title = "Confirm",
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  confirmVariant = "primary",
}: UConfirmModalProps): JSX.Element | null {
  /*
   * We inline minimal button styles here to avoid a circular dependency on UButton.
   * Consumers who want styled buttons can use the base UModal with a custom footer.
   * These buttons still reference design tokens for visual consistency.
   */
  const footer = (
    <>
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        style={{
          border: "2px solid var(--color-border-btn)",
          borderRadius: "var(--radius-md)",
          padding: "0.55rem 0.8rem",
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: loading ? "not-allowed" : "pointer",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          opacity: loading ? 0.5 : 1,
        }}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        aria-busy={loading || undefined}
        style={{
          border: "2px solid var(--color-border-btn)",
          borderRadius: "var(--radius-md)",
          padding: "0.55rem 0.8rem",
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: loading ? "wait" : "pointer",
          background:
            confirmVariant === "danger"
              ? "var(--color-danger)"
              : "var(--color-accent)",
          color: "var(--color-white)",
          opacity: loading ? 0.5 : 1,
        }}
      >
        {loading ? "..." : confirmLabel}
      </button>
    </>
  );

  return (
    <UModal open={open} onClose={onCancel} title={title} footer={footer}>
      {children}
    </UModal>
  );
}
