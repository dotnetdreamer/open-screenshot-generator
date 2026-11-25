"use client";

// Director, loaded the first time it opens rather than with the editor: its 3D
// stage, the recording reader and the video encoder stay out of the editor's
// start-up. Loaded on its own, a failure stays inside Director, behind the
// message below. "Try again" makes a new import() each time, because
// next/dynamic and React.lazy keep the first answer, a failure included (the
// SEO view does the same, LazySeoWorkspace.tsx).

import { Component, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { DirectorWorkspace as DirectorWorkspaceView } from './DirectorWorkspace';

type View = typeof DirectorWorkspaceView;

function Loading() {
  return (
    <div role="status" className="flex h-full w-full items-center justify-center bg-background">
      <span className="sr-only">Opening Director</span>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <h2 className="text-base font-semibold">Director couldn&apos;t open</h2>
      <p className="max-w-sm text-sm text-muted-foreground">Try again or restart the app if Director still won&apos;t open</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

class DirectorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Director failed', error);
  }

  render() {
    return this.state.failed ? <Failed onRetry={this.props.onRetry} /> : this.props.children;
  }
}

export function LazyDirectorWorkspace(props: ComponentProps<View>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; view: View | null }>({ attempt: -1, view: null });
  useEffect(() => {
    let current = true;
    import('./DirectorWorkspace').then(
      (module) => {
        if (current) setLoaded({ attempt, view: module.DirectorWorkspace });
      },
      (error: unknown) => {
        console.error('Director failed to load', error);
        if (current) setLoaded({ attempt, view: null });
      }
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  const retry = () => setAttempt((count) => count + 1);
  if (loaded.attempt !== attempt) return <Loading />;
  if (!loaded.view) return <Failed onRetry={retry} />;
  const DirectorWorkspace = loaded.view;
  return (
    <DirectorBoundary key={attempt} onRetry={retry}>
      <DirectorWorkspace {...props} />
    </DirectorBoundary>
  );
}
