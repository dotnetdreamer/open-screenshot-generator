"use client";

// The one font picker. Both places that let someone choose a typeface (the
// Properties panel and the Translate dialog) render this, so an imported font
// shows up in both without either having to know how importing works.

import type React from 'react';
import { useRef, useState } from 'react';
import { Loader2, Trash2Icon, TypeIcon, UploadIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { getGroupedFontOptions } from '@/services/fontService';
import {
  FONT_FILE_ACCEPT,
  deleteCustomFont,
  formatFontSize,
  importFontFile,
  useCustomFonts,
} from '@/services/customFonts';

interface FontOption {
  value: string;
  label: string;
  fallback: string;
}

function FontOptions({ fonts }: { fonts: FontOption[] }) {
  return (
    <>
      {fonts.map(font => (
        <SelectItem
          key={font.value}
          value={font.value}
          style={{ fontFamily: `'${font.value}', ${font.fallback}` }}
        >
          {font.label}
        </SelectItem>
      ))}
    </>
  );
}

interface FontFamilySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Rendered above every group, for options like "Keep current fonts". */
  leadingItems?: React.ReactNode;
  /** Adds the import button, and the manager behind it, next to the select. */
  allowImport?: boolean;
}

export function FontFamilySelect({
  value,
  onValueChange,
  id,
  placeholder = 'Font Family',
  className,
  leadingItems,
  allowImport = false,
}: FontFamilySelectProps) {
  const groupedFonts = getGroupedFontOptions();
  const customFonts = useCustomFonts();

  const select = (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={className ?? 'w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {leadingItems}
        {customFonts.length > 0 && (
          <SelectGroup>
            <SelectLabel>Your Fonts</SelectLabel>
            <FontOptions
              fonts={customFonts.map(font => ({
                value: font.family,
                label: font.family,
                fallback: 'sans-serif',
              }))}
            />
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Display and Handwriting</SelectLabel>
          <FontOptions fonts={groupedFonts.display} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>System Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.system} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Latin Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.latin} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Arabic Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.arabic} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Urdu Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.urdu} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Hebrew Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.hebrew} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Chinese, Japanese and Korean Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.cjk} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Thai Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.thai} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Devanagari Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.devanagari} />
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Bengali Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.bengali} />
        </SelectGroup>
        {/* Cyrillic and Greek have no group: the Latin and Multilingual faces
            above already carry both scripts, so a group here would be the same
            families listed twice, which a Select cannot do (one value, two
            items) and nobody would thank us for. */}
        <SelectGroup>
          <SelectLabel>Multilingual Fonts</SelectLabel>
          <FontOptions fonts={groupedFonts.multilingual} />
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  if (!allowImport) return select;

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{select}</div>
      <CustomFontManager onImported={onValueChange} />
    </div>
  );
}

/**
 * Import button plus the list of what has already been imported.
 * `onImported` receives the new family so the caller can apply it right away,
 * which is what someone who just picked a file is expecting to see.
 */
function CustomFontManager({ onImported }: { onImported: (family: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const customFonts = useCustomFonts();
  const { toast } = useToast();

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear before any await so picking the same file twice still fires.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setIsImporting(true);
    try {
      const font = await importFontFile(file);
      onImported(font.family);
      toast({
        title: `${font.family} is ready`,
        description: 'It is now in the font list for every project on this device.',
      });
    } catch (error) {
      toast({
        title: 'Could not import that font',
        description: error instanceof Error ? error.message : 'The file could not be read as a font.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async (id: string, family: string) => {
    try {
      await deleteCustomFont(id);
      toast({
        title: `Removed ${family}`,
        description: 'Text still using it falls back to the default font.',
      });
    } catch {
      toast({ title: 'Could not remove that font', variant: 'destructive' });
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={FONT_FILE_ACCEPT}
        onChange={handleFileSelected}
        className="hidden"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            title="Import a font from your computer"
            aria-label="Import a font from your computer"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TypeIcon className="h-4 w-4" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Your fonts</p>
              <p className="text-xs text-muted-foreground">
                Bring in a typeface the built-in list does not have. Files stay on this device
              </p>
            </div>

            <Button
              className="w-full"
              size="sm"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadIcon className="mr-2 h-4 w-4" />
              )}
              {isImporting ? 'Importing' : 'Import font file'}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              TTF, OTF, WOFF or WOFF2, up to 12 MB. Check the licence before you publish
            </p>

            {customFonts.length > 0 && (
              <div className="max-h-56 space-y-1 overflow-y-auto border-t pt-2">
                {customFonts.map(font => (
                  <div
                    key={font.id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm"
                        style={{ fontFamily: `'${font.family}', sans-serif` }}
                        title={font.family}
                      >
                        {font.family}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {font.format.toUpperCase()}, {formatFontSize(font.size)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      title={`Remove ${font.family}`}
                      aria-label={`Remove ${font.family}`}
                      onClick={() => handleDelete(font.id, font.family)}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
