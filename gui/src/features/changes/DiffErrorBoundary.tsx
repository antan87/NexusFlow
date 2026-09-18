/**
 * Diff Error Boundary Component
 * Shields the application from crashes during Monaco diff mounting or text model initialization,
 * rendering a clean fallback banner with retry action and raw diff inspection.
 * File: gui/src/features/changes/DiffErrorBoundary.tsx
 */
import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface DiffErrorBoundaryProps {
  filePath?: string;
  fallbackContent?: string;
  children: ReactNode;
}

interface DiffErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class DiffErrorBoundary extends Component<DiffErrorBoundaryProps, DiffErrorBoundaryState> {
  constructor(props: DiffErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): DiffErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[DiffErrorBoundary] Caught error in diff viewer:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-foreground space-y-3 my-2">
          <div className="flex items-center gap-2 font-medium text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Failed to render diff editor for {this.props.filePath || 'file'}</span>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground break-all bg-background/80 p-2 rounded border border-border/60">
            {this.state.error?.message || 'Unknown diff rendering error'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border bg-card hover:bg-accent text-foreground cursor-pointer transition-colors font-mono"
            >
              <RefreshCw className="size-3" />
              <span>Retry Render</span>
            </button>
          </div>
          {this.props.fallbackContent && (
            <div className="mt-3">
              <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">
                Raw Diff Content
              </div>
              <pre className="font-mono text-[11px] bg-background/90 text-foreground p-3 rounded border border-border max-h-72 overflow-auto whitespace-pre">
                {this.props.fallbackContent}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
