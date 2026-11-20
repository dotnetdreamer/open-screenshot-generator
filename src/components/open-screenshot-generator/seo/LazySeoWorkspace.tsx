"use client";

// The SEO view, loaded the first time it opens rather than with the editor.
// Its checks are large, and they're ports of Python patterns: one a web view
// can't read (WebKit before Safari 16.4 couldn't parse a lookbehind, and
// macOS 10.15 stops at Safari 15.6) would otherwise stop the editor loading
// too. Loaded on its own, any such failure stays inside the SEO view, behind
// the message below.
//
// "Try again" loads the code again. next/dynamic and React.lazy keep the
// first answer to the import, a failure included, so a code file that didn't
// arrive (the connection dropped) would never be asked for again: the import
// here is a plain import() held in state, and each try makes a new one. The
// bundler forgets a code file that failed, so a new import() fetches it anew.

import { Component, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { SeoWorkspace as SeoWorkspaceView } from './SeoWorkspace';

type View = typeof SeoWorkspaceView;

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
      <h2 className="text-base font-semibold">The SEO view couldn't open</h2>
      <p className="max-w-sm text-sm text-muted-foreground">The rest of the app works as before. Try again, or restart the app if it keeps happening.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The view throwing while it draws (code this web view can't run, say) shows the message, not a blank screen. */
class SeoBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The SEO view failed', error);
  }

  render() {
    return this.state.failed ? <Failed onRetry={this.props.onRetry} /> : this.props.children;
  }
}

export function LazySeoWorkspace(props: ComponentProps<View>) {
  // Each try loads the code again and starts the view afresh (a new boundary, by key).
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; view: View | null }>({ attempt: -1, view: null });
  useEffect(() => {
    let current = true;
    import('./SeoWorkspace').then(
      (module) => {
        if (current) setLoaded({ attempt, view: module.SeoWorkspace });
      },
      (error: unknown) => {
        console.error('The SEO view failed to load', error);
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
  const SeoWorkspace = loaded.view;
  return (
    <SeoBoundary key={attempt} onRetry={retry}>
      <SeoWorkspace {...props} />
    </SeoBoundary>
  );
}
