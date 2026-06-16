import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional label shown in the fallback, e.g. the page name. */
  label?: string;
  /** Custom fallback renderer. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time exceptions so a single broken component doesn't blank
 * the whole app. Wrap the app root (catch-all) and individual heavy pages
 * (localised recovery). Data-fetch errors are handled by ErrorState/useTable;
 * this is the backstop for unexpected throws.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console for now; a logging sink (Sentry/etc.) plugs in here.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="text-amber-500">
          <AlertTriangle size={32} />
        </span>
        <div>
          <p className="text-base font-semibold text-gray-800">
            Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            The page hit an unexpected error. You can try again, or reload if it persists.
          </p>
        </div>
        <pre className="max-w-md overflow-auto rounded bg-gray-50 p-2 text-left text-[11px] text-gray-400">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
