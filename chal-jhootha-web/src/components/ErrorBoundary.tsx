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
        <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center text-white p-4 text-center">
          <h1 className="text-3xl font-serif text-gold-400 mb-4">Something went wrong</h1>
          <p className="text-neutral-300 mb-8 max-w-md">
            The game encountered an unexpected error. Don't worry, your progress might be saved.
          </p>
          <button
            className="px-6 py-3 bg-white text-green-900 font-bold rounded-xl hover:bg-neutral-200 transition-colors"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reconnect
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
