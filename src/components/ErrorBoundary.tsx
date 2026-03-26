import React, { Component, ErrorInfo, ReactNode } from 'react';

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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-rose-200 max-w-lg w-full">
            <h2 className="text-xl font-bold text-rose-600 mb-4">页面发生崩溃</h2>
            <p className="text-slate-700 mb-4">很抱歉，程序遇到了一些问题：</p>
            <pre className="bg-slate-100 p-4 rounded-lg text-sm text-rose-600 overflow-auto whitespace-pre-wrap max-h-64">
              {this.state.error?.message || '未知错误'}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="mt-6 w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              刷新页面重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
