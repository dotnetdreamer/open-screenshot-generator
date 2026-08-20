"use client";

// The list of projects saved to our cloud.
//
// A panel rather than a dialog, because it lives inside AccountDialog next to
// the list of projects in the user's own Drive or gists. Those two answer the
// same question — "where are my projects" — and asking it used to open one of
// two different dialogs depending on which storage you happened to guess.
//
// It owns its own list, deletion and sharing. Only the two things that need the
// editor come in as props: saving what is currently open, and opening one of
// these into the canvas.

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckIcon,
  CloudUploadIcon,
  CopyIcon,
  FolderOpenIcon,
  LinkIcon,
  Link2OffIcon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
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
import { useToast } from '@/hooks/use-toast';
import { formatBytes } from '@/lib/account/projectBundle';
import {
  buildShareUrl,
  deleteCloudProject,
  listCloudProjects,
  setCloudProjectShared,
  type CloudProject,
} from '@/lib/cloud';

export interface CloudProjectsPanelProps {
  /** Re-list whenever this flips true, so opening the dialog refreshes. */
  isVisible: boolean;
  /** There is a community session to attribute these to. */
  isSignedIn: boolean;
  /** The project open in the editor, so it can be pushed from here. */
  activeProjectId: string | null;
  activeProjectName: string;
  isSaving: boolean;
  onSave: () => void;
  /** Pull one down. `asCopy` leaves a local project of the same id alone. */
  onOpenProject: (project: CloudProject, asCopy: boolean) => Promise<void>;
  /** Local project ids on this device, to mark the overlap. */
  localProjectIds: Set<string>;
  /** Called after a project is opened, so the host can close itself. */
  onOpened?: () => void;
}

/**
 * PocketBase writes `2026-08-17 09:12:44.512Z`, with a space rather than a T.
 * V8 parses it and other engines are within their rights not to, so the swap
 * happens here rather than being left to whoever opens this on an iPad.
 */
function whenLabel(value: string): string {
  const parsed = Date.parse(String(value || '').replace(' ', 'T'));
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CloudProjectsPanel({
  isVisible,
  isSignedIn,
  activeProjectId,
  activeProjectName,
  isSaving,
  onSave,
  onOpenProject,
  localProjectIds,
  onOpened,
}: CloudProjectsPanelProps) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<CloudProject[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [isListing, setIsListing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CloudProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) {
      setProjects(null);
      return;
    }
    setIsListing(true);
    setError(null);
    try {
      const page = await listCloudProjects();
      setProjects(page.projects);
      setLimit(page.limit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those could not be listed.');
    } finally {
      setIsListing(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (isVisible) void refresh();
  }, [isVisible, refresh]);

  const handleOpen = async (project: CloudProject, asCopy: boolean) => {
    setBusyId(project.id);
    // Closed before the download starts, not after it finishes. The editor
    // reports the open on the canvas, and this dialog sitting on top of it for
    // the whole wait is what made opening a large project look like nothing was
    // happening. A failure still lands as a toast, over the canvas the user
    // came back to.
    onOpened?.();
    try {
      await onOpenProject(project, asCopy);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Share, and put the URL on the clipboard in the same click.
   *
   * Already shared, this re-copies rather than re-issuing: minting a new slug
   * here would break a link somebody had already been sent.
   */
  const handleCopyLink = async (project: CloudProject) => {
    setBusyId(project.id);
    try {
      let url = '';
      if (project.visibility === 'link' && project.shareSlug) {
        url = buildShareUrl(project.shareSlug);
      } else {
        const result = await setCloudProjectShared(project.id, project.projectId, true);
        url = result.url;
        setProjects((current) =>
          (current ?? []).map((entry) =>
            entry.id === project.id
              ? { ...entry, visibility: result.visibility, shareSlug: result.shareSlug }
              : entry
          )
        );
      }
      // A WebView or an insecure context can refuse the clipboard. The toast
      // carries the URL in that case, so the link is never simply lost.
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      if (copied) {
        setCopiedId(project.id);
        window.setTimeout(() => setCopiedId((id) => (id === project.id ? null : id)), 2000);
      } else {
        toast({ title: 'Your share link', description: url });
      }
    } catch (err) {
      toast({
        title: 'Could not copy that link',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleStopSharing = async (project: CloudProject) => {
    setBusyId(project.id);
    try {
      await setCloudProjectShared(project.id, project.projectId, false);
      setProjects((current) =>
        (current ?? []).map((entry) =>
          entry.id === project.id ? { ...entry, visibility: 'private', shareSlug: '' } : entry
        )
      );
      toast({
        title: 'Link turned off',
        description: 'That URL no longer opens anything. Sharing again makes a new one.',
      });
    } catch (err) {
      toast({
        title: 'Could not stop sharing',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    try {
      await deleteCloudProject(toDelete.id);
      setProjects((current) => (current ?? []).filter((entry) => entry.id !== toDelete.id));
      toast({
        title: 'Deleted from the cloud',
        description: `"${toDelete.name}" is gone from here. The copy on this device is untouched.`,
      });
      setToDelete(null);
    } catch (err) {
      toast({
        title: 'Could not delete that',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isSignedIn) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Connecting an account above is what gives you somewhere to save.
      </p>
    );
  }

  const activeIsSaved = (projects ?? []).some((entry) => entry.projectId === activeProjectId);

  return (
    <>
      <div className="space-y-3">
        {activeProjectId && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{activeProjectName}</p>
              <p className="text-xs text-muted-foreground">
                {activeIsSaved ? 'Already here, and kept up to date on its own' : 'Not up here yet. It goes up on its own, or press Save'}
              </p>
            </div>
            <Button size="sm" onClick={onSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CloudUploadIcon className="mr-2 h-4 w-4" />
              )}
              {activeIsSaved ? 'Update' : 'Save'}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Projects in the cloud
            {!!limit && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {(projects ?? []).length} of {limit}
              </span>
            )}
          </h3>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={isListing}>
            {isListing ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="h-4 w-4" />
            )}
          </Button>
        </div>

        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {!error && isListing && !projects && (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading your projects...</p>
        )}

        {!error && projects?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing here yet. The project you have open goes up on its own shortly after you
            work on it, or send it now with Save.
          </p>
        )}

        {/* A native overflow div, not a Radix ScrollArea: one under a max-h
            parent silently stops scrolling. See globals.css. */}
        {!!projects?.length && (
          <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
            {projects.map((project) => {
              const isBusy = busyId === project.id;
              const onThisDevice = localProjectIds.has(project.projectId);
              return (
                <li key={project.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        <span className="truncate">{project.name}</span>
                        {project.visibility === 'link' && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary"
                            title="Anyone with the link can open a copy"
                          >
                            <LinkIcon className="h-2.5 w-2.5" />
                            shared
                          </span>
                        )}
                        {/* The title goes on a wrapper, not the icon: lucide's
                            props do not include it, and an SVG `title`
                            attribute is not a tooltip anyway. */}
                        {onThisDevice && (
                          <span
                            className="shrink-0 text-muted-foreground"
                            title="A project with this id is also on this device"
                          >
                            <MonitorSmartphoneIcon className="h-3 w-3" />
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {project.boards} {project.boards === 1 ? 'artboard' : 'artboards'} ·{' '}
                        {formatBytes(project.docBytes + project.assetBytes)} ·{' '}
                        {whenLabel(project.updated)}
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title={
                        onThisDevice
                          ? 'Open as a separate copy, leaving the version on this device alone'
                          : 'Open this project'
                      }
                      onClick={() => void handleOpen(project, onThisDevice)}
                    >
                      {isBusy ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpenIcon className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title={
                        project.visibility === 'link'
                          ? 'Copy the share link'
                          : 'Turn on a share link and copy it'
                      }
                      onClick={() => void handleCopyLink(project)}
                    >
                      {copiedId === project.id ? (
                        <CheckIcon className="h-4 w-4 text-primary" />
                      ) : (
                        <CopyIcon className="h-4 w-4" />
                      )}
                    </Button>

                    {project.visibility === 'link' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        title="Stop sharing. The current link stops working for good"
                        onClick={() => void handleStopSharing(project)}
                      >
                        <Link2OffIcon className="h-4 w-4" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title="Delete from the cloud"
                      onClick={() => setToDelete(project)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(next) => {
          if (!next && !isDeleting) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete from the cloud?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{toDelete?.name}&quot; and everything it references will be removed from your
              cloud storage. Any share link stops working. The copy on this device is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // The action closes the dialog by default, which would unmount
                // the spinner mid-request.
                event.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
