"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
  message = "Não conseguimos carregar esta parte do app.",
  onReset,
}: {
  title?: string;
  message?: string;
  onReset?: () => void;
}) {
  return (
    <div role="alert" className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card p-6">
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-base text-muted-foreground">{message}</p>
        {onReset && (
          <Button onClick={onReset} className="mt-6">
            Tentar novamente
          </Button>
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
