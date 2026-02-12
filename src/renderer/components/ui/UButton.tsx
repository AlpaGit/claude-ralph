import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./UButton.module.css";

/* ── Public types ──────────────────────────────────────── */

export type UButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type UButtonSize = "sm" | "md" | "lg";

export interface UButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant. Defaults to "primary". */
  variant?: UButtonVariant;
  /** Size preset. Defaults to "md". */
  size?: UButtonSize;
  /** Show a loading spinner and disable interaction. */
  loading?: boolean;
  /** Content rendered inside the button. */
  children?: ReactNode;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Component ─────────────────────────────────────────── */

export const UButton = forwardRef<HTMLButtonElement, UButtonProps>(function UButton(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        styles.btn,
        styles[variant],
        styles[size],
        loading && styles.loading,
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span>{children}</span>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <span className={styles.spinnerIcon} />
        </span>
      ) : null}
    </button>
  );
});
