/**
 * Toast notification service.
 *
 * Typed wrapper around react-hot-toast providing success, error, info, and
 * warning methods with consistent brutalist styling applied globally via
 * the Toaster component in AppShell.
 *
 * The error() method accepts an optional IpcError second parameter. When
 * provided and the error contains developer details (validation issues or
 * stack trace), it renders a custom ErrorToast with a collapsible "Details"
 * section. Plain string-only calls fall back to the standard react-hot-toast
 * error renderer.
 */
import { createElement } from "react";
import toast from "react-hot-toast";
import type { IpcError } from "@shared/types";
import { hasIpcErrorDetails } from "./ipcErrorService";
import { ErrorToast } from "../components/ui/ErrorToast";

export type ToastType = "success" | "error" | "info" | "warning";

/**
 * Show a success toast (green accent).
 */
export function success(message: string): string {
  return toast.success(message, {
    iconTheme: { primary: "#15803d", secondary: "#fff" },
  });
}

/**
 * Show an error toast (red accent).
 *
 * When a structured IpcError with details is passed, renders a custom
 * ErrorToast component with an expandable "Details" section showing the
 * error code, validation issues, and stack trace. Otherwise falls back
 * to the standard react-hot-toast error renderer.
 *
 * @param message  Human-readable error summary.
 * @param details  Optional structured IPC error with code, details, and stack.
 */
export function error(message: string, details?: IpcError): string {
  // Use custom renderer when we have structured details worth showing
  if (details && hasIpcErrorDetails(details)) {
    return toast.custom((t) => createElement(ErrorToast, { t, message, error: details }), {
      duration: 12000,
    });
  }

  return toast.error(message, {
    iconTheme: { primary: "#b91c1c", secondary: "#fff" },
    duration: 6000,
  });
}

/**
 * Show an informational toast (teal accent).
 */
export function info(message: string): string {
  return toast(message, {
    icon: "\u2139\uFE0F",
    duration: 4000,
  });
}

/**
 * Show a warning toast (amber accent, 5s duration).
 * Uses the default amber border (#d97706) from Toaster base style.
 * Duration is longer than info/success (4s) to give users time to read warnings.
 */
export function warning(message: string): string {
  return toast(message, {
    icon: "\u26A0\uFE0F",
    style: { borderColor: "#d97706" },
    duration: 5000,
  });
}

/**
 * Convenience namespace-like export so callers can use:
 *   import { toastService } from "./services/toastService";
 *   toastService.success("Done!");
 */
export const toastService = { success, error, info, warning } as const;
