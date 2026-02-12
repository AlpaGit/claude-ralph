/**
 * Toast notification service.
 *
 * Typed wrapper around react-hot-toast providing success, error, info, and
 * warning methods with consistent brutalist styling applied globally via
 * the Toaster component in AppShell.
 */
import toast from "react-hot-toast";

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
 */
export function error(message: string): string {
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
 * Show a warning toast (amber accent).
 */
export function warning(message: string): string {
  return toast(message, {
    icon: "\u26A0\uFE0F",
    duration: 5000,
  });
}

/**
 * Convenience namespace-like export so callers can use:
 *   import { toastService } from "./services/toastService";
 *   toastService.success("Done!");
 */
export const toastService = { success, error, info, warning } as const;
