'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className='flex flex-col items-center justify-center gap-3 p-4 rounded-lg border border-red-500/20 bg-red-950/10 text-center'>
          <p className='text-sm text-red-400'>Something went wrong</p>
          <p className='text-xs text-neutral-500 max-w-xs truncate'>
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleRetry}
            className='px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors'>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
