"use client";

// Connect an account, then browse what is stored in it.
//
// Two lists live here now, behind tabs, because "where are my projects" has two
// answers and it is one question:
//
//   In the cloud       on our backend (src/lib/cloud). We hold these, they count
//                      against a quota, and they are the only ones that can
//                      produce a share link.
//   In your <provider> in the user's own Drive or gists. We never hold a copy,
//                      there is no plan and no quota from us, and there is
//                      nothing on our side to delete. The copy in here should
//                      keep saying that.
//
// One sign-in covers both: the community session the cloud list needs is minted
// from whichever storage account is connected, so the connect buttons below are
// the only door either list has.

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { isTauri, openExternal } from '@/lib/desktop';
import { CloudProjectsPanel } from '../cloud/CloudProjectsPanel';
import type { CloudProject } from '@/lib/cloud';
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
import { useEditorPreference } from '@/lib/editorPreferences';

const TOKEN_HELP_URL = 'https://github.com/settings/tokens?type=beta';

type AccountTab = 'cloud' | 'storage';

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown at the top when opened from a gated action. */
  hint?: string;
  /** Load a project from the user's own storage into the editor. */
  onOpenProject?: (remoteId: string, name: string) => void;

  // --- our cloud, when this build has a backend ---------------------------
  /** Undefined hides the cloud tab entirely, leaving the dialog as it was. */
  cloud?: {
    /** A community session exists, so the cloud list can be attributed. */
    isSignedIn: boolean;
    activeProjectId: string | null;
    activeProjectName: string;
    isSaving: boolean;
    onSave: () => void;
    onOpenProject: (project: CloudProject, asCopy: boolean) => Promise<void>;
    localProjectIds: Set<string>;
  };
  /** Which list to land on. Ignored when there is no cloud tab. */
  initialTab?: AccountTab;
}

export function AccountDialog({
  open,
  onOpenChange,
  hint,
  onOpenProject,
  cloud,
  initialTab = 'cloud',
}: AccountDialogProps) {
  const { session, isSignedIn, signOut } = useAccount();
  // Lives here rather than in Settings because it is a fact about this storage,
  // not about the editor: it belongs next to the list of what is in there and
  // the account it belongs to. The value itself is still a shared preference
  // (AGENTS.md rule 25), because the syncer reads it from outside React.
  const [autoSync, setAutoSync] = useEditorPreference('accountAutoSync');
  const { toast } = useToast();
  const [tab, setTab] = useState<AccountTab>(initialTab);

  const [busyProvider, setBusyProvider] = useState<CloudProviderId | null>(null);
  const [showTokenField, setShowTokenField] = useState(false);
  const [token, setToken] = useState('');
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [projects, setProjects] = useState<CloudProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isListing, setIsListing] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<CloudProjectSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!isSignedIn) return;
    setIsListing(true);
    setListError(null);
    try {
      setProjects(await listAccountProjects());
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not list your projects.');
    } finally {
      setIsListing(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (open && isSignedIn) void refreshProjects();
    if (open) {
      // Reopening from a different entry point has to land on the list that
      // entry point meant, not on whichever tab was left showing last time.
      setTab(initialTab);
    }
    if (!open) {
      setShowTokenField(false);
      setToken('');
      setDeviceCode(null);
      setProjectToDelete(null);
    }
  }, [open, isSignedIn, refreshProjects, initialTab]);

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
      toast({ title: `${provider.label} is not set up`, description: provider.configHint, variant: 'destructive' });
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
      toast({ title: `Connected to ${provider.label}`, description: `Signed in as ${next.account.name}.` });
      // A hint means this dialog was opened by something the person was
      // already trying to do (share a design, like a post, save a project).
      // Hand them straight back to it: leaving them parked in a project list
      // they never asked for makes signing in feel like a detour.
      if (hint) onOpenChange(false);
    } catch (error) {
      if (!(error instanceof AccountCancelledError)) {
        toast({
          title: `Could not connect to ${provider.label}`,
          description: error instanceof Error ? error.message : 'Something went wrong.',
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
      toast({ title: 'Signed out', description: 'Your projects stay in your own storage.' });
    }
  };

  const handleDelete = async (project: CloudProjectSummary) => {
    setIsDeleting(true);
    try {
      await deleteAccountProject(project.remoteId);
      setProjects((current) => current?.filter((p) => p.remoteId !== project.remoteId) ?? null);
      setProjectToDelete(null);
      toast({ title: 'Deleted', description: `"${project.name}" was removed from your storage.` });
    } catch (error) {
      toast({
        title: 'Could not delete',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const providerLabel = session ? getProvider(session.provider).label : '';
  /**
   * The product the projects are actually in.
   *
   * `provider.label` is "Google" / "GitHub", which reads fine in "connected to
   * Google" and badly on a tab, where "Google" alone does not say Drive. The
   * tabs are two proper nouns and nothing else, so they stay short enough to sit
   * side by side at this dialog's width.
   */
  const storageLabel = session?.provider === 'github' ? 'GitHub' : 'Google Drive';
  /**
   * With no cloud tab there is only one list, so the Tabs root has to sit on it
   * whatever `initialTab` said. Without this, a build with no backend opens on a
   * 'cloud' tab that renders nothing and looks like an empty dialog.
   */
  const effectiveTab: AccountTab = cloud ? tab : 'storage';

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudIcon className="h-5 w-5" />
            {isSignedIn ? 'Your account' : 'Save to your own storage'}
          </DialogTitle>
          <DialogDescription>
            {/* Signed in with both lists available, the description cannot claim
                we keep no copy: one of the two tabs is a copy we keep. It says
                which is which instead, and the storage tab's own copy still
                makes the "your files, not ours" point. */}
            {!isSignedIn
              ? 'Connect an account and your projects are saved to storage you own. Nothing is stored on our servers.'
              : cloud
                ? `Cloud projects live on our backend and can be shared by link. Your ${storageLabel} is storage you own, and we never keep a copy of what is in it.`
                : `Projects are saved to your own ${providerLabel} storage. We never keep a copy.`}
          </DialogDescription>
        </DialogHeader>

        {hint && !isSignedIn && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{hint}</p>
        )}

        {isSignedIn && session ? (
          /*
           * One Tabs root either way, with the list of triggers rendered only
           * when there is a second list to switch to. That keeps the storage
           * panel inside a Tabs context in both shapes — a bare TabsContent
           * throws — and `effectiveTab` is what stops a build with no backend
           * from sitting on a 'cloud' tab that does not exist.
           */
          <Tabs
            value={effectiveTab}
            onValueChange={(next) => setTab(next as AccountTab)}
            className="space-y-4"
          >
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Avatar className="h-10 w-10">
                {session.account.avatarUrl && <AvatarImage src={session.account.avatarUrl} alt="" />}
                <AvatarFallback>{session.account.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">Welcome, {session.account.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {session.account.email ? `${session.account.email}, ` : ''}connected to {providerLabel}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOutIcon className="mr-1.5 h-4 w-4" />
                Sign out
              </Button>
            </div>

            {/* Directly under the account and above the tabs, because it is a
                fact about the connection rather than about whichever list is
                showing: it applies to the projects in that storage no matter
                which tab somebody happens to be on. It is also the only place
                that answers "why has nothing synced", so burying it under a
                scrolling list would be the wrong half of the dialog. */}
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <Label htmlFor="account-auto-sync" className="text-sm font-medium">
                  Keep saved projects up to date
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Later edits go to your {providerLabel} on their own, shortly after you stop
                  typing. Only projects already saved there are touched, nothing new is ever
                  created for you, and files a project stopped using are cleaned up only when you
                  save by hand
                </p>
              </div>
              <Switch
                id="account-auto-sync"
                checked={autoSync}
                onCheckedChange={setAutoSync}
                aria-label="Keep saved projects up to date"
              />
            </div>

            {/* Tabs only when there are two lists to choose between. With no
                backend configured this renders exactly the single list it
                always did. */}
            {cloud && (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cloud">Cloud</TabsTrigger>
                <TabsTrigger value="storage">{storageLabel}</TabsTrigger>
              </TabsList>
            )}

            {cloud && (
              // No bare `flex` on TabsContent: it defeats [hidden]{display:none}
              // and the inactive panel leaks its spacing into the active one.
              <TabsContent value="cloud" className="mt-0">
                <CloudProjectsPanel
                  isVisible={open && tab === 'cloud'}
                  isSignedIn={cloud.isSignedIn}
                  activeProjectId={cloud.activeProjectId}
                  activeProjectName={cloud.activeProjectName}
                  isSaving={cloud.isSaving}
                  onSave={cloud.onSave}
                  onOpenProject={cloud.onOpenProject}
                  localProjectIds={cloud.localProjectIds}
                  onOpened={() => onOpenChange(false)}
                />
              </TabsContent>
            )}

            <TabsContent value="storage" className="mt-0">
              <div className="mb-2 flex items-center justify-between">
                {/* The heading is redundant once the tab above says the same
                    thing, so it only appears when there are no tabs. */}
                {!cloud && <h3 className="text-sm font-medium">Projects in your {providerLabel}</h3>}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cloud ? 'ml-auto' : undefined}
                  onClick={refreshProjects}
                  disabled={isListing}
                >
                  {isListing ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {listError && <p className="text-sm text-destructive">{listError}</p>}

              {!listError && isListing && !projects && (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading your projects...</p>
              )}

              {!listError && projects?.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing saved yet. Use Save &gt; To your own storage in the toolbar.
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
                        title="Open this project"
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
                        title="Delete from your storage"
                        onClick={() => setProjectToDelete(project)}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
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
                    Continue with {provider.label}
                    {!provider.supportsMedia && (
                      <span className="ml-auto text-xs text-muted-foreground">no video</span>
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
                      Use a personal access token instead
                    </Button>
                  )}

                  {id === 'github' && showTokenField && !isTauri() && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        Create a fine-grained token with read and write access to Gists.
                        {!hasGithubLogin() &&
                          ' A token is needed here because no sign-in service is configured for this build.'}
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
                          Create a token
                          <ExternalLinkIcon className="ml-1 h-3 w-3" />
                        </Button>
                        <Button size="sm" disabled={!token.trim() || !!busyProvider} onClick={() => handleSignIn('github')}>
                          Connect
                        </Button>
                      </div>
                    </div>
                  )}

                  {id === 'github' && deviceCode && (
                    <div className="space-y-2 rounded-md border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        Enter this code on GitHub to finish signing in. This window keeps waiting.
                      </p>
                      <p className="text-center text-lg font-mono tracking-widest">{deviceCode.userCode}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => void openExternal(deviceCode.verificationUri)}
                      >
                        Open {deviceCode.verificationUri.replace(/^https?:\/\//, '')}
                        <ExternalLinkIcon className="ml-1.5 h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground">
              Google Drive stores full projects including screen recordings. GitHub stores the
              design only, since gists cannot hold video.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={!!projectToDelete}
      onOpenChange={(next) => {
        if (!next && !isDeleting) setProjectToDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete from {providerLabel || 'your storage'}?</AlertDialogTitle>
          <AlertDialogDescription>
            &quot;{projectToDelete?.name}&quot; will be removed from your {providerLabel || 'cloud'}{' '}
            storage. Your local copy stays on this device. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
            onClick={(event) => {
              // Keep the dialog up until the request finishes.
              event.preventDefault();
              if (projectToDelete) void handleDelete(projectToDelete);
            }}
          >
            {isDeleting && <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
