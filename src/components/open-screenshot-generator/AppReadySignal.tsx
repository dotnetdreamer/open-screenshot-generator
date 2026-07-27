"use client";
import { useEffect } from "react";
import { signalAppReady } from "@/lib/desktop";

/**
 * Closes the desktop splash screen once the studio has mounted. Renders
 * nothing, and does nothing on the web. Must be the last child of the tree it
 * is waiting on: React runs effects bottom-up, so by the time this fires its
 * siblings have committed.
 */
export function AppReadySignal() {
  useEffect(() => {
    void signalAppReady();
  }, []);

  return null;
}
