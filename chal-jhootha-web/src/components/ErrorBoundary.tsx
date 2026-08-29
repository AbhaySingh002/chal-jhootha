import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="page-shell flex items-center justify-center text-center">
          <section className="brutal-card w-full max-w-lg p-5 sm:p-8" role="alert">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Connection interrupted</p>
            <h1 className="mt-3 font-display text-4xl uppercase text-ink">Something went wrong</h1>
            <p className="mx-auto mt-4 max-w-md font-mono text-sm leading-6 text-ink-muted">
              The game hit an unexpected error. Your room may still be available after reconnecting.
            </p>
            <div className="mt-7 grid gap-3">
              <button
              className="brutal-btn bg-caution-yellow text-ink"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reconnect
            </button>
              <a href="/" className="brutal-btn inline-flex items-center justify-center bg-surface text-ink">Return home</a>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
