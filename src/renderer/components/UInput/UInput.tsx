import { useId, type InputHTMLAttributes, type JSX } from "react";
import styles from "./UInput.module.css";

export interface UInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Label text rendered above the input. */
  label?: string;
  /** Error message. When set, the input adopts an error visual state. */
  error?: string;
  /** Helper text rendered below the input (hidden when error is present). */
  helperText?: string;
  /** Additional CSS class names appended to the root wrapper element. */
  className?: string;
}

export function UInput({
  label,
  error,
  helperText,
  className,
  id: externalId,
  ...inputProps
}: UInputProps): JSX.Element {
  const generatedId = useId();
  const inputId = externalId ?? generatedId;

  const wrapperClass = className ? `${styles.wrapper} ${className}` : styles.wrapper;
  const inputClass = error ? `${styles.input} ${styles.inputError}` : styles.input;

  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = !error && helperText ? `${inputId}-helper` : undefined;
  const describedBy = errorId ?? helperId;

  return (
    <div className={wrapperClass}>
      {label ? (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <input
        id={inputId}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />

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
  );
}
