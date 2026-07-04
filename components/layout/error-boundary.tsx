"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the error card to identify which area crashed. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * React class-based error boundary.
 * Wraps any subtree and renders a recovery card instead of a white screen
 * when an uncaught render error bubbles up.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">
              {this.props.label ?? "Something went wrong"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {this.state.error.message}
            </p>
          </div>
          <button
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => this.setState({ error: null })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
