"use client";

// Connect an account, then browse what is stored in it.
//
// The pitch to the user is that this is *their* storage: we never hold their
// files, so there is no plan, no quota from us, and nothing to delete on our
// side. The copy in here should keep saying that.

import React, { useCallback, useEffect, useState } from 'react';
import {
  CloudIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  Loader2Icon,
  LogOutIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { isTauri, openExternal } from '@/lib/desktop';
import {
  AccountCancelledError,
  CLOUD_PROVIDERS,
  deleteAccountProject,
  getProvider,
  listAccountProjects,
  setSession,
  useAccount,
  type CloudProjectSummary,
  type CloudProviderId,
} from '@/lib/account';
import { hasGithubLogin } from '@/lib/account/providers/github';
import { useT } from '@/i18n';

const TOKEN_HELP_URL = 'https://github.com/settings/tokens?type=beta';

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown at the top when opened from a gated action. */
  hint?: string;
  /** Load a project from the account into the editor. */
  onOpenProject?: (remoteId: string, name: string) => void;
}

export function AccountDialog({ open, onOpenChange, hint, onOpenProject }: AccountDialogProps) {
  const { session, isSignedIn, signOut } = useAccount();
  const { toast } = useToast();
  const t = useT();

  const [busyProvider, setBusyProvider] = useState<CloudProviderId | null>(null);
  const [showTokenField, setShowTokenField] = useState(false);
  const [token, setToken] = useState('');
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [projects, setProjects] = useState<CloudProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isListing, setIsListing] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!isSignedIn) return;
    setIsListing(true);
    setListError(null);
    try {
      setProjects(await listAccountProjects());
    } catch (error) {
      setListError(error instanceof Error ? error.message : t('account.listErrorFallback'));
    } finally {
      setIsListing(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (open && isSignedIn) void refreshProjects();
    if (!open) {
      setShowTokenField(false);
      setToken('');
      setDeviceCode(null);
    }
  }, [open, isSignedIn, refreshProjects]);

  const handleSignIn = async (id: CloudProviderId) => {
    const provider = getProvider(id);

    // Without the sign-in Worker there is no secretless redirect flow on the
    // web, so GitHub asks for a token instead. Reveal that field on the first
    // click; with a Worker configured this is a real login and we go straight
    // to the popup.
    if (id === 'github' && !isTauri() && !hasGithubLogin() && !showTokenField) {
      setShowTokenField(true);
      return;
    }
    if (!provider.isConfigured()) {
      toast({ title: t('account.providerNotSetup', { provider: provider.label }), description: provider.configHint, variant: 'destructive' });
      return;
    }

    setBusyProvider(id);
    setDeviceCode(null);
    try {
      const next = await provider.signIn({
        token: id === 'github' ? token : undefined,
        onUserCode: (info) => setDeviceCode(info),
      });
      setSession(next);
      setToken('');
      setShowTokenField(false);
      setDeviceCode(null);
      toast({ title: t('account.connected', { provider: provider.label }), description: t('account.connectedDesc', { name: next.account.name }) });
    } catch (error) {
      if (!(error instanceof AccountCancelledError)) {
        toast({
          title: t('account.couldNotConnect', { provider: provider.label }),
          description: error instanceof Error ? error.message : t('account.somethingWentWrong'),
          variant: 'destructive',
        });
      }
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSignOut = async () => {
    if (!session) return;
    const provider = getProvider(session.provider);
    try {
      await provider.signOut(session);
    } finally {
      signOut();
      setProjects(null);
      toast({ title: t('account.signedOut'), description: t('account.signedOutDesc') });
    }
  };

  const handleDelete = async (project: CloudProjectSummary) => {
    if (!window.confirm(t('account.confirmDelete', { name: project.name, provider: session ? getProvider(session.provider).label : 'cloud' }))) {
      return;
    }
    try {
      await deleteAccountProject(project.remoteId);
      setProjects((current) => current?.filter((p) => p.remoteId !== project.remoteId) ?? null);
      toast({ title: t('account.deleted'), description: t('account.deletedDesc', { name: project.name }) });
    } catch (error) {
      toast({
        title: t('account.couldNotDelete'),
        description: error instanceof Error ? error.message : t('account.somethingWentWrong'),
        variant: 'destructive',
      });
    }
  };

  const providerLabel = session ? getProvider(session.provider).label : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudIcon className="h-5 w-5" />
            {isSignedIn ? t('account.titleSignedIn') : t('account.titleSignedOut')}
          </DialogTitle>
          <DialogDescription>
            {isSignedIn
              ? t('account.descSignedIn', { provider: providerLabel })
              : t('account.descSignedOut')}
          </DialogDescription>
        </DialogHeader>

        {hint && !isSignedIn && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{hint}</p>
        )}

        {isSignedIn && session ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Avatar className="h-10 w-10">
                {session.account.avatarUrl && <AvatarImage src={session.account.avatarUrl} alt="" />}
                <AvatarFallback>{session.account.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t('account.welcome', { name: session.account.name })}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.account.email ? `${session.account.email}, ` : ''}{t('account.connectedTo', { provider: providerLabel })}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOutIcon className="mr-1.5 h-4 w-4" />
                {t('account.signOut')}
              </Button>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{t('account.projectsIn', { provider: providerLabel })}</h3>
                <Button variant="ghost" size="sm" onClick={refreshProjects} disabled={isListing}>
                  {isListing ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {listError && <p className="text-sm text-destructive">{listError}</p>}

              {!listError && isListing && !projects && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('account.loadingProjects')}</p>
              )}

              {!listError && projects?.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('account.nothingSaved')}
                </p>
              )}

              {!!projects?.length && (
                <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
                  {projects.map((project) => (
                    <li
                      key={project.remoteId}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {project.modifiedAt.toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('account.openProject')}
                        onClick={() => {
                          onOpenProject?.(project.remoteId, project.name);
                          onOpenChange(false);
                        }}
                      >
                        <FolderOpenIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('account.deleteFromStorage')}
                        onClick={() => handleDelete(project)}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(Object.keys(CLOUD_PROVIDERS) as CloudProviderId[]).map((id) => {
              const provider = CLOUD_PROVIDERS[id];
              const isBusy = busyProvider === id;
              return (
                <div key={id} className="space-y-2">
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-start"
                    disabled={!!busyProvider}
                    onClick={() => handleSignIn(id)}
                  >
                    {isBusy ? (
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ProviderMark id={id} />
                    )}
                    {t('account.continueWith', { provider: provider.label })}
                    {!provider.supportsMedia && (
                      <span className="ml-auto text-xs text-muted-foreground">{t('account.noVideo')}</span>
                    )}
                  </Button>

                  {/* With a sign-in Worker the popup is the normal path, but a
                      token still works for anyone who prefers it. */}
                  {id === 'github' && !isTauri() && hasGithubLogin() && !showTokenField && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => setShowTokenField(true)}
                    >
                      {t('account.useToken')}
                    </Button>
                  )}

                  {id === 'github' && showTokenField && !isTauri() && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        {t('account.tokenHelp')}
                        {!hasGithubLogin() && ` ${t('account.tokenHelpNoService')}`}
                      </p>
                      <Input
                        type="password"
                        placeholder="github_pat_..."
                        value={token}
                        autoComplete="off"
                        onChange={(event) => setToken(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && token.trim()) void handleSignIn('github');
                        }}
                      />
                      <div className="flex items-center justify-between">
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => void openExternal(TOKEN_HELP_URL)}
                        >
                          {t('account.createToken')}
                          <ExternalLinkIcon className="ml-1 h-3 w-3" />
                        </Button>
                        <Button size="sm" disabled={!token.trim() || !!busyProvider} onClick={() => handleSignIn('github')}>
                          {t('account.connect')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {id === 'github' && deviceCode && (
                    <div className="space-y-2 rounded-md border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {t('account.deviceCodeHelp')}
                      </p>
                      <p className="text-center text-lg font-mono tracking-widest">{deviceCode.userCode}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => void openExternal(deviceCode.verificationUri)}
                      >
                        {t('account.openUrl', { url: deviceCode.verificationUri.replace(/^https?:\/\//, '') })}
                        <ExternalLinkIcon className="ml-1.5 h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground">
              {t('account.providersNote')}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inline brand marks so the dialog needs no network image. */
function ProviderMark({ id }: { id: CloudProviderId }) {
  if (id === 'google') {
    return (
      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24z" />
        <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.4-.4-2.4s.1-1.7.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.5l4 3.1C6.3 6.8 8.9 4.8 12 4.8z" />
      </svg>
    );
  }
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
