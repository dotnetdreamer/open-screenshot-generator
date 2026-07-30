"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const LANGUAGES = [
  { code: "sq", name: "Albanian" },
  { code: "ar", name: "Arabic" },
  { code: "az", name: "Azerbaijani" },
  { code: "eu", name: "Basque" },
  { code: "bn", name: "Bengali" },
  { code: "bg", name: "Bulgarian" },
  { code: "ca", name: "Catalan" },
  { code: "zh-Hans", name: "Chinese" },
  { code: "zh-Hant", name: "Chinese (traditional)" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "eo", name: "Esperanto" },
  { code: "et", name: "Estonian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "gl", name: "Galician" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "ga", name: "Irish" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ky", name: "Kyrgyz" },
  { code: "lv", name: "Latvian" },
  { code: "lt", name: "Lithuanian" },
  { code: "ms", name: "Malay" },
  { code: "nb", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sr", name: "Serbian" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Tagalog" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" }
];

export interface TranslateDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onTranslate: (targetLanguage: string, allArtboards: boolean) => Promise<void>;
}

export function TranslateDialog({
  isOpen,
  onOpenChange,
  onTranslate,
}: TranslateDialogProps) {
  const [targetLanguage, setTargetLanguage] = useState<string>('es');
  const [allArtboards, setAllArtboards] = useState<boolean>(true);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  const handleTranslate = async () => {
    setIsTranslating(true);
    try {
      await onTranslate(targetLanguage, allArtboards);
      onOpenChange(false);
    } catch (error) {
      console.error('Translation failed', error);
      // Let the parent handle toasts if needed
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Translate Text</DialogTitle>
          <DialogDescription>
            Translate text elements in your artboards. Rate limits apply (10 requests / 5000 characters per minute).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="language" className="text-right">
              Target
            </Label>
            <div className="col-span-3">
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger id="language">
                  <SelectValue placeholder="Select a language" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <div className="col-start-2 col-span-3 flex items-center space-x-2">
              <Checkbox 
                id="allArtboards" 
                checked={allArtboards} 
                onCheckedChange={(checked) => setAllArtboards(!!checked)} 
              />
              <Label htmlFor="allArtboards" className="text-sm font-normal">
                Translate all artboards
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isTranslating}>
            Cancel
          </Button>
          <Button onClick={handleTranslate} disabled={isTranslating}>
            {isTranslating ? 'Translating...' : 'Translate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
