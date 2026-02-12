import type { JSX, ReactNode } from "react";
import styles from "./UCard.module.css";

export interface UCardProps {
  /** Optional heading rendered inside the card header. */
  title?: string;
  /** Optional secondary text below the title. */
  subtitle?: string;
  /** Optional element rendered to the right of the title (e.g. a status pill). */
  headerAction?: ReactNode;
  /** Optional footer content rendered at the bottom with a dashed border separator. */
  footer?: ReactNode;
  /** Additional CSS class names appended to the root element. */
  className?: string;
  /** Card body content. */
  children: ReactNode;
}

export function UCard({
  title,
  subtitle,
  headerAction,
  footer,
  className,
  children,
}: UCardProps): JSX.Element {
  const rootClass = className ? `${styles.card} ${className}` : styles.card;

  const hasHeader = title !== undefined || headerAction !== undefined;

  return (
    <div className={rootClass}>
      {hasHeader ? (
        <div className={styles.header}>
          <div>
            {title ? <h2 className={styles.title}>{title}</h2> : null}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {headerAction ?? null}
        </div>
      ) : null}

      {!hasHeader && subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}

      <div className={styles.body}>{children}</div>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
