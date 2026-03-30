"use client";

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic error boundary component for catching React errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  resetIfNeeded(nextProps: Readonly<ErrorBoundaryProps>): void {
    if (nextProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidUpdate(prevProps: Readonly<ErrorBoundaryProps>): void {
    if (this.props.children !== prevProps.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }
    this.setState({ hasError: true, error });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

/**
 * Error fallback UI with reset option.
 */
export function ErrorFallback({
  title = "Algo deu errado",
  message = "Ocorreu um erro inesperado. Tente novamente.",
  onReset,
}: {
  title?: string;
  message?: string;
  onReset?: () => void;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-6">
      <div className="text-center">
        <div className="mb-2 text-2xl font-semibold text-destructive">{title}</div>
        <div className="text-sm text-destructive/80">{message}</div>
        {onReset && (
          <button
            onClick={onReset}
            className="mt-4 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90"
            type="button"
            aria-label="Tentar novamente"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onReset();
              }
            }}
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Higher-order component to wrap a component tree with an error boundary.
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    fallback?: ReactNode;
    title?: string;
    message?: string;
    onReset?: () => void;
  }
) {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";

  const ComponentWithErrorBoundary = (props: P) => {
    return (
      <ErrorBoundary
        fallback={
          options?.fallback ?? (
            <ErrorFallback
              title={options?.title}
              message={options?.message}
              onReset={options?.onReset}
            />
          )
        }
        onReset={options?.onReset}
      >
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };

  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

  return ComponentWithErrorBoundary;
}
