import { Component } from "react";
import type { ErrorInfo, JSX, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { UCard } from "../UCard/UCard";
import { UButton } from "../ui/UButton";
import styles from "./ErrorBoundary.module.css";

/* ── Helpers ───────────────────────────────────────────── */

const isDev = import.meta.env?.DEV ?? false;

/* ── AppErrorBoundary ──────────────────────────────────── */

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * AppErrorBoundary wraps the entire <RouterProvider> and catches
 * catastrophic errors that escape individual views. It shows a
 * full-page error card with an app restart (reload) button.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = info.componentStack ?? null;
    this.setState({ componentStack: stack });
    console.error("[AppErrorBoundary] Uncaught error:", error);
    if (stack) {
      console.error("[AppErrorBoundary] Component stack:", stack);
    }
  }

  private handleRestart = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, componentStack } = this.state;

    return (
      <div className={styles.appError}>
        <div className={styles.appErrorCard}>
          <UCard
            title="Something went wrong"
            headerAction={<span className={styles.errorIcon}>!!</span>}
            footer={
              <div className={styles.actions}>
                <UButton variant="primary" onClick={this.handleRestart}>
                  Restart App
                </UButton>
              </div>
            }
          >
            <p className={styles.description}>
              A critical error occurred and the application cannot continue. Restarting the app will
              reset the UI to its initial state.
            </p>

            {error ? (
              <pre className={styles.errorMessage}>{error.message || String(error)}</pre>
            ) : null}

            {isDev && componentStack ? (
              <>
                <p className={styles.stackLabel}>Component Stack</p>
                <pre className={styles.componentStack}>{componentStack}</pre>
              </>
            ) : null}
          </UCard>
        </div>
      </div>
    );
  }
}

/* ── ViewErrorBoundary ─────────────────────────────────── */

interface ViewErrorBoundaryProps {
  children: ReactNode;
  /** Optional callback when the user clicks "Go Home". */
  onNavigateHome?: () => void;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * ViewErrorBoundary wraps individual route views and catches per-view
 * errors. It shows an error card with a retry button and an optional
 * link to navigate home. Other views remain functional.
 */
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ViewErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = info.componentStack ?? null;
    this.setState({ componentStack: stack });
    console.error("[ViewErrorBoundary] Uncaught error:", error);
    if (stack) {
      console.error("[ViewErrorBoundary] Component stack:", stack);
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  private handleNavigateHome = (): void => {
    this.setState({ hasError: false, error: null, componentStack: null });
    this.props.onNavigateHome?.();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, componentStack } = this.state;

    return (
      <div className={styles.viewError}>
        <div className={styles.viewErrorCard}>
          <UCard
            title="View Error"
            headerAction={<span className={styles.errorIcon}>!</span>}
            footer={
              <div className={styles.actions}>
                <UButton variant="primary" onClick={this.handleRetry}>
                  Retry
                </UButton>
                {this.props.onNavigateHome ? (
                  <UButton variant="ghost" onClick={this.handleNavigateHome}>
                    Go Home
                  </UButton>
                ) : null}
              </div>
            }
          >
            <p className={styles.description}>
              An error occurred while rendering this view. Other views should still be accessible.
              You can retry or navigate home.
            </p>

            {error ? (
              <pre className={styles.errorMessage}>{error.message || String(error)}</pre>
            ) : null}

            {isDev && componentStack ? (
              <>
                <p className={styles.stackLabel}>Component Stack</p>
                <pre className={styles.componentStack}>{componentStack}</pre>
              </>
            ) : null}
          </UCard>
        </div>
      </div>
    );
  }
}

/* ── RouteErrorBoundary ─────────────────────────────────── */

/**
 * Functional wrapper around ViewErrorBoundary that provides the
 * onNavigateHome callback using react-router-dom's useNavigate hook.
 * Use this component to wrap route elements so the "Go Home" button
 * navigates to "/" via the router.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();

  const handleNavigateHome = (): void => {
    navigate("/");
  };

  return <ViewErrorBoundary onNavigateHome={handleNavigateHome}>{children}</ViewErrorBoundary>;
}
