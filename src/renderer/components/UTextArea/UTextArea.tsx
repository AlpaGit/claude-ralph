import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type JSX,
  type TextareaHTMLAttributes
} from "react";
import styles from "./UTextArea.module.css";

export interface UTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  /** Label text rendered above the textarea. */
  label?: string;
  /** Error message. When set, the textarea adopts an error visual state. */
  error?: string;
  /** Helper text rendered below the textarea (hidden when error is present). */
  helperText?: string;
  /** Maximum character count. When set, a live counter is shown. */
  maxLength?: number;
  /** Enable auto-resize: the textarea grows vertically to fit content. Default false. */
  autoResize?: boolean;
  /** Additional CSS class names appended to the root wrapper element. */
  className?: string;
}

export function UTextArea({
  label,
  error,
  helperText,
  maxLength,
  autoResize = false,
  className,
  id: externalId,
  value,
  onChange,
  ...textareaProps
}: UTextAreaProps): JSX.Element {
  const generatedId = useId();
  const textareaId = externalId ?? generatedId;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrapperClass = className ? `${styles.wrapper} ${className}` : styles.wrapper;

  const textareaClasses = [styles.textarea];
  if (error) textareaClasses.push(styles.textareaError);
  if (autoResize) textareaClasses.push(styles.textareaAutoResize);
  const textareaClass = textareaClasses.join(" ");

  const errorId = error ? `${textareaId}-error` : undefined;
  const helperId = !error && helperText ? `${textareaId}-helper` : undefined;
  const describedBy = errorId ?? helperId;

  const currentLength = typeof value === "string" ? value.length : 0;
  const isOverLimit = maxLength !== undefined && currentLength > maxLength;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !autoResize) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [autoResize]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange?.(event);
    if (autoResize) {
      // Defer to next tick so DOM value is updated before measuring
      requestAnimationFrame(adjustHeight);
    }
  };

  const charCountClass = isOverLimit
    ? `${styles.charCount} ${styles.charCountOver}`
    : styles.charCount;

  const showFooter = error || helperText || maxLength !== undefined;

  return (
    <div className={wrapperClass}>
      {label ? (
        <label className={styles.label} htmlFor={textareaId}>
          {label}
        </label>
      ) : null}

      <textarea
        ref={textareaRef}
        id={textareaId}
        className={textareaClass}
        value={value}
        onChange={handleChange}
        maxLength={undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...textareaProps}
      />

      {showFooter ? (
        <div className={styles.footer}>
          <div>
            {error ? (
              <p id={errorId} className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}

            {!error && helperText ? (
              <p id={helperId} className={styles.helperText}>
                {helperText}
              </p>
            ) : null}
          </div>

          {maxLength !== undefined ? (
            <p className={charCountClass}>
              {currentLength} / {maxLength}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
