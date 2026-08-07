"use client";
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ImageIcon,
  ImagePlusIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import type { ElementType, ShapeType, DeviceType } from '@/types/artboard';
import {
  deleteMedia,
  getMediaDataUrl,
  renameMedia,
  saveMedia,
  useMediaUrl,
  type MediaAsset,
} from '@/lib/mediaStore';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// Same signature as ElementPalette's PaletteDragStart, redeclared so this
// panel does not import from its parent (LibraryItemTile does the same).
type PaletteDragStart = (
  e: React.DragEvent<HTMLElement> | null,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  styleProps?: Record<string, any>
) => void;

/** The element payload a dropped/clicked upload mints, same shape the Images library tiles use. */
const stylePropsFor = (asset: MediaAsset, dataUrl: string) => ({
  imageSrc: dataUrl,
  imageAlt: asset.name,
  name: asset.name,
  defaultSize: { width: asset.width || 400, height: asset.height || 300 },
});

const RenameInput: React.FC<{
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}> = ({ initial, onCommit, onCancel }) => {
  const [value, setValue] = useState(initial);
  return (
    <Input
      autoFocus
      value={value}
      aria-label="Rename upload"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-6 px-1 text-[10px]"
    />
  );
};

/** One uploaded image: draggable thumbnail + rename/delete affordances on hover. */
const UploadedImageTile: React.FC<{
  asset: MediaAsset;
  renaming: boolean;
  onDragStart: PaletteDragStart;
  onEnsureDataUrl: (id: string) => Promise<string | null>;
  onPeekDataUrl: (id: string) => string | undefined;
  onBeginRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}> = ({
  asset,
  renaming,
  onDragStart,
  onEnsureDataUrl,
  onPeekDataUrl,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}) => {
  // Object URL from the shared cache: thumbnails never hold data URLs.
  const thumbUrl = useMediaUrl(asset.id);

  return (
    <li className="group relative flex flex-col gap-1">
      <button
        type="button"
        className="flex aspect-square w-full cursor-grab items-center justify-center overflow-hidden rounded-lg bg-accent/10 p-1.5 transition-colors hover:bg-accent/25 active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          const dataUrl = onPeekDataUrl(asset.id);
          if (!dataUrl) {
            // The pointerdown/hover prime almost always wins this race; if it
            // did not, cancel the drag, keep priming, and let the retry work.
            e.preventDefault();
            void onEnsureDataUrl(asset.id);
            return;
          }
          onDragStart(e, 'image', undefined, stylePropsFor(asset, dataUrl));
        }}
        onClick={() => {
          void onEnsureDataUrl(asset.id).then((dataUrl) => {
            if (dataUrl) (onDragStart as any)(null, 'image', undefined, stylePropsFor(asset, dataUrl));
          });
        }}
        onPointerDown={() => void onEnsureDataUrl(asset.id)}
        onPointerEnter={() => void onEnsureDataUrl(asset.id)}
        title={`Add ${asset.name}`}
        aria-label={`Add ${asset.name}`}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
        ) : (
          <ImageIcon className="w-5 h-5 text-muted-foreground/50" />
        )}
      </button>
      {renaming ? (
        <RenameInput initial={asset.name} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight break-words">
          {asset.name}
        </span>
      )}
      {!renaming && (
        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={onBeginRename}
            title={`Rename ${asset.name}`}
            aria-label={`Rename ${asset.name}`}
            className="flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow transition-colors hover:text-foreground"
          >
            <PencilIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title={`Delete ${asset.name}`}
            aria-label={`Delete ${asset.name}`}
            className="flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow transition-colors hover:text-destructive"
          >
            <Trash2Icon className="h-3 w-3" />
          </button>
        </div>
      )}
    </li>
  );
};

interface UploadsPanelProps {
  // The palette owns the list (its Images overview card shows recent uploads);
  // this panel mutates and then asks the palette to re-list via onChanged.
  assets: MediaAsset[];
  onChanged: () => void;
  onDragStart: PaletteDragStart;
}

/**
 * The user's uploaded image library (Images tab > Your uploads). Files are
 * stored as blobs in the Dexie media table; dragging a tile onto the canvas
 * mints the element's imageSrc as a data URL read from the blob, so the
 * project row serializes exactly like an Images-library drop.
 */
export function UploadsPanel({ assets, onChanged, onDragStart }: UploadsPanelProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Data URLs are minted only for tiles the user actually interacts with
  // (hover/press prime, dragstart consumes synchronously, click awaits), so a
  // large library never sits in memory as one base64 string per tile.
  const dataUrlCacheRef = useRef(new Map<string, string>());
  const dataUrlInflightRef = useRef(new Map<string, Promise<string | null>>());

  const ensureDataUrl = useCallback((id: string): Promise<string | null> => {
    const cached = dataUrlCacheRef.current.get(id);
    if (cached) return Promise.resolve(cached);
    const inflight = dataUrlInflightRef.current.get(id);
    if (inflight) return inflight;
    const promise = getMediaDataUrl(id).then((dataUrl) => {
      if (dataUrl) dataUrlCacheRef.current.set(id, dataUrl);
      return dataUrl;
    });
    dataUrlInflightRef.current.set(id, promise);
    const clear = () => dataUrlInflightRef.current.delete(id);
    promise.then(clear, clear);
    return promise;
  }, []);

  const peekDataUrl = useCallback((id: string) => dataUrlCacheRef.current.get(id), []);

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) {
      if (files.length > 0) setError('Only image files can be uploaded here.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Sequential saves keep createdAt in the order the files were picked.
      for (const file of images) {
        await saveMedia(file, file.name);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those images could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (asset: MediaAsset, name: string) => {
    setRenamingId(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === asset.name) return;
    try {
      await renameMedia(asset.id, trimmed);
      onChanged();
    } catch {
      toast({ title: 'Rename failed', description: 'The upload could not be renamed.', variant: 'destructive' });
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    try {
      // Elements created from this upload hold their own data URL copy, so
      // deleting the library row never blanks a canvas element.
      await deleteMedia(asset.id);
      dataUrlCacheRef.current.delete(asset.id);
      onChanged();
    } catch {
      toast({ title: 'Delete failed', description: 'The upload could not be deleted.', variant: 'destructive' });
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (busy || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setDragActive(false);
        if (!busy) void addFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'rounded-lg transition-colors',
        dragActive && 'bg-primary/5 ring-2 ring-inset ring-primary'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 px-4 py-6 text-center">
          {busy ? (
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlusIcon className="h-6 w-6 text-muted-foreground" />
          )}
          <p className="text-sm text-muted-foreground">No uploads yet. Drop image files here, or</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
          <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, GIF or SVG</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-muted-foreground">Drag a tile onto the canvas, or click to add it</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
            </Button>
          </div>
          <ul className="grid grid-cols-3 gap-2 pr-1">
            {assets.map((asset) => (
              <UploadedImageTile
                key={asset.id}
                asset={asset}
                renaming={renamingId === asset.id}
                onDragStart={onDragStart}
                onEnsureDataUrl={ensureDataUrl}
                onPeekDataUrl={peekDataUrl}
                onBeginRename={() => setRenamingId(asset.id)}
                onCommitRename={(name) => void handleRename(asset, name)}
                onCancelRename={() => setRenamingId(null)}
                onDelete={() => void handleDelete(asset)}
              />
            ))}
          </ul>
        </>
      )}

      {error && <p className="mt-2 px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
