"use client";

// The Uptime view, loaded the first time it opens rather than with the
// editor, the way the SEO view is (LazySeoWorkspace.tsx explains why the
// import is a plain import() held in state). A failure to load or to draw
// stays inside the view, behind the message below.

import { Component, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { UptimeWorkspace as UptimeWorkspaceView } from './UptimeWorkspace';

type View = typeof UptimeWorkspaceView;

function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <h2 className="text-base font-semibold">The Uptime view couldn&apos;t open</h2>
      <p className="max-w-sm text-sm text-muted-foreground">Your monitors keep being checked. Try again, or restart the app if it keeps happening.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

class UptimeBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The Uptime view failed', error);
  }

  render() {
    return this.state.failed ? <Failed onRetry={this.props.onRetry} /> : this.props.children;
  }
}

export function LazyUptimeWorkspace(props: ComponentProps<View>) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; view: View | null }>({ attempt: -1, view: null });
  useEffect(() => {
    let current = true;
    import('./UptimeWorkspace').then(
      (module) => {
        if (current) setLoaded({ attempt, view: module.UptimeWorkspace });
      },
      (error: unknown) => {
        console.error('The Uptime view failed to load', error);
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
  const UptimeWorkspace = loaded.view;
  return (
    <UptimeBoundary key={attempt} onRetry={retry}>
      <UptimeWorkspace {...props} />
    </UptimeBoundary>
  );
}
