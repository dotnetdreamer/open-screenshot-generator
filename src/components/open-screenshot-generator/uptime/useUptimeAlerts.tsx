"use client";

// Uptime's alerts inside the app: in the main editor window (`toasts`), a
// toast for each one Rust sends, with a way to the monitor, and on Windows
// and Linux, where the page shows the system notification itself, that
// notification. In every editor window, the number of monitors down for the
// activity bar's badge. Starts Uptime's store at once, so the badge is right
// before the view has opened.

import React, { useEffect, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { downCount, onUptimeAlert, startUptime, useUptime } from '@/lib/uptime/store';

export function useUptimeAlerts({ enabled, toasts, onOpen }: { enabled: boolean; toasts: boolean; onOpen: (id: string) => void }): number {
  const { toast } = useToast();
  const { view } = useUptime();
  const settings = useRef(view?.settings);
  settings.current = view?.settings;
  const notifications = useRef(view?.notifications);
  notifications.current = view?.notifications;
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    if (enabled) void startUptime();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !toasts) return;
    return onUptimeAlert((alert) => {
      // A test from the Alerts screen shows where it was asked for.
      if (alert.kind === 'test') return;
      toast({
        title: alert.title,
        description: alert.body,
        variant: alert.kind === 'down' || alert.kind === 'reminder' ? 'destructive' : undefined,
        action: alert.id ? (
          <ToastAction altText={`See ${alert.name} in Uptime`} onClick={() => open.current(alert.id)}>
            See
          </ToastAction>
        ) : undefined,
      });
      const wanted = settings.current?.desktop && notifications.current === 'page';
      if (wanted && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const shown = new Notification(alert.title, { body: alert.body, silent: !settings.current?.sound, tag: `uptime-${alert.id}-${alert.kind}` });
          shown.onclick = () => {
            window.focus();
            if (alert.id) open.current(alert.id);
          };
        } catch (error) {
          console.error('The notification could not be shown', error);
        }
      }
    });
  }, [enabled, toasts, toast]);

  return enabled ? downCount(view) : 0;
}
