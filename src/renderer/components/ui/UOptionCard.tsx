import {
  useCallback,
  useRef,
  useState,
  useEffect,
  type JSX,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import styles from "./UOptionCard.module.css";

/* ── Constants ────────────────────────────────────────── */

/** Sentinel value that identifies the "Other" free-text option. */
export const OTHER_OPTION_VALUE = "__other__";

/* ── Public types ──────────────────────────────────────── */

export interface UOptionCardProps {
  /** Unique value for this option (used by parent to track selection). */
  value: string;
  /** The option text displayed on the card. */
  label: string;
  /** Whether the AI recommends this option. Shows a subtle badge. */
  isRecommended: boolean;
  /** Whether this option is currently selected. */
  isSelected: boolean;
  /** Determines radio (single) vs checkbox (multi) visual indicator. */
  selectionMode: "single" | "multi";
  /** Callback fired when the card is clicked or activated via keyboard. */
  onSelect: (value: string) => void;
  /**
   * Callback for free-text input when this is the "Other" option.
   * Only relevant when value === OTHER_OPTION_VALUE.
   */
  onOtherText?: (text: string) => void;
  /** Optional disabled state. */
  disabled?: boolean;
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/* ── Component ─────────────────────────────────────────── */

export function UOptionCard({
  value,
  label,
  isRecommended,
  isSelected,
  selectionMode,
  onSelect,
  onOtherText,
  disabled = false,
  className,
}: UOptionCardProps): JSX.Element {
  const isOther = value === OTHER_OPTION_VALUE;
  const [otherText, setOtherText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* Auto-focus the free-text input when "Other" is selected */
  useEffect(() => {
    if (isOther && isSelected && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOther, isSelected]);

  const handleClick = useCallback(() => {
    if (!disabled) onSelect(value);
  }, [disabled, onSelect, value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onSelect(value);
      }
    },
    [disabled, onSelect, value],
  );

  const handleOtherChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setOtherText(text);
      onOtherText?.(text);
    },
    [onOtherText],
  );

  /** Prevent card click/select from firing when clicking inside the input */
  const handleInputClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const isRadio = selectionMode === "single";

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        styles.card,
        isSelected && styles.selected,
        disabled && styles.disabled,
        className,
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Selection indicator */}
      <span
        className={cn(styles.indicator, isRadio ? styles.indicatorRadio : styles.indicatorCheckbox)}
        aria-hidden="true"
      >
        <span className={styles.indicatorMark} />
      </span>

      {/* Label + optional Other input */}
      <span className={styles.content}>
        <span className={styles.label}>{label}</span>

        {isOther && isSelected ? (
          <input
            ref={inputRef}
            type="text"
            className={styles.otherInput}
            placeholder="Type your answer..."
            value={otherText}
            onChange={handleOtherChange}
            onClick={handleInputClick}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Other option text"
            disabled={disabled}
          />
        ) : null}
      </span>

      {/* Recommended badge */}
      {isRecommended ? (
        <span className={styles.badge} aria-label="Recommended">
          Recommended
        </span>
      ) : null}
    </div>
  );
}
