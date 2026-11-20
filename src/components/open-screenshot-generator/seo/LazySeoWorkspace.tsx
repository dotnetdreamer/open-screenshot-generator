"use client";

// The SEO view, loaded the first time it opens rather than with the editor.
// Its checks are large, and they're ports of Python patterns: one a web view
// can't read (WebKit before Safari 16.4 couldn't parse a lookbehind, and
// macOS 10.15 stops at Safari 15.6) would otherwise stop the editor loading
// too. Loaded on its own, any such failure stays inside the SEO view, behind
// the message below.

import { Component, type ComponentProps, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import type { SeoWorkspace as SeoWorkspaceView } from './SeoWorkspace';

const SeoWorkspace = dynamic(() => import('./SeoWorkspace').then((m) => m.SeoWorkspace), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  ),
});

class SeoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The SEO view failed to load', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <h2 className="text-base font-semibold">The SEO view couldn't open</h2>
        <p className="max-w-sm text-sm text-muted-foreground">The rest of the app works as before. Try again, or restart the app if it keeps happening.</p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}

export function LazySeoWorkspace(props: ComponentProps<typeof SeoWorkspaceView>) {
  return (
    <SeoBoundary>
      <SeoWorkspace {...props} />
    </SeoBoundary>
  );
}
