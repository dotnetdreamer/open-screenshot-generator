"use client";

import React, { useEffect, useState } from 'react';
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
import { AUTO_DETECT } from '@/services/translation';
import { getGroupedFontOptions } from '@/services/fontService';
import { getRecommendedFontForLanguage } from '@/lib/fontLanguageMatcher';
import { SelectGroup, SelectLabel } from "@/components/ui/select";
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

export const LANGUAGES = [
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

export function getLanguageName(code: string): string {
  return LANGUAGES.find((lang) => lang.code === code)?.name || code;
}

export interface TranslateDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /**
   * Language the artboard text is currently in, when a previous translation
   * recorded it. Seeds the source picker so translating twice in a row does not
   * keep claiming the text is still English.
   */
  currentLanguage?: string;
  disableAllArtboardsOption?: boolean;
  /**
   * 'element' narrows the run to the one text element the properties panel
   * opened this from, so the artboard scope controls make no sense and are
   * dropped rather than shown disabled.
   */
  scope?: 'project' | 'element';
  onTranslate: (targetLanguage: string, allArtboards: boolean, sourceLanguage: string, targetFont?: string) => Promise<void>;
}

export function TranslateDialog({
  isOpen,
  onOpenChange,
  currentLanguage,
  disableAllArtboardsOption = false,
  scope = 'project',
  onTranslate,
}: TranslateDialogProps) {
  const t = useT();
  const [sourceLanguage, setSourceLanguage] = useState<string>(AUTO_DETECT);
  const [targetLanguage, setTargetLanguage] = useState<string>('es');
  const [targetFont, setTargetFont] = useState<string>('keep_current');
  const [allArtboards, setAllArtboards] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  const groupedFonts = getGroupedFontOptions();

  // Re-seed every time the dialog opens: the project's language changes under
  // us after each run, so a stale source is worse than no source at all.
  useEffect(() => {
    if (!isOpen) return;
    if (disableAllArtboardsOption) {
      setAllArtboards(false);
    }
    const knownSource =
      currentLanguage && LANGUAGES.some((lang) => lang.code === currentLanguage)
        ? currentLanguage
        : AUTO_DETECT;
    setSourceLanguage(knownSource);
    // After translating to Polish the target is still Polish, which is now a
    // no-op. Offer the reverse trip instead, which is what people want next.
    setTargetLanguage((prev) => {
      const newTarget = prev === knownSource ? (knownSource === 'en' ? 'es' : 'en') : prev;
      
      // Auto-select font based on initial target language
      const recommendedFont = getRecommendedFontForLanguage(newTarget);
      setTargetFont(recommendedFont || 'keep_current');
      
      return newTarget;
    });
  }, [isOpen, currentLanguage, disableAllArtboardsOption]);

  const handleTargetLanguageChange = (lang: string) => {
    setTargetLanguage(lang);
    const recommendedFont = getRecommendedFontForLanguage(lang);
    setTargetFont(recommendedFont || 'keep_current');
  };

  const sameLanguage = sourceLanguage !== AUTO_DETECT && sourceLanguage === targetLanguage;

  const handleTranslate = async () => {
    setIsTranslating(true);
    try {
      await onTranslate(
        targetLanguage, 
        allArtboards, 
        sourceLanguage, 
        targetFont === 'keep_current' ? undefined : targetFont
      );
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
          <DialogTitle>{scope === 'element' ? t('translateDialog.titleElement') : t('translateDialog.titleProject')}</DialogTitle>
          <DialogDescription>
            {scope === 'element'
              ? t('translateDialog.descElement')
              : t('translateDialog.descProject')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="sourceLanguage" className="text-right">
              {t('translateDialog.source')}
            </Label>
            <div className="col-span-3">
              <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
                <SelectTrigger id="sourceLanguage">
                  <SelectValue placeholder={t('translateDialog.detectAutomatically')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_DETECT}>{t('translateDialog.detectAutomatically')}</SelectItem>
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
            <Label htmlFor="language" className="text-right">
              {t('translateDialog.target')}
            </Label>
            <div className="col-span-3">
              <Select value={targetLanguage} onValueChange={handleTargetLanguageChange}>
                <SelectTrigger id="language">
                  <SelectValue placeholder={t('translateDialog.selectLanguage')} />
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
            <Label htmlFor="targetFont" className="text-right">
              {t('translateDialog.font')}
            </Label>
            <div className="col-span-3">
              <Select value={targetFont} onValueChange={setTargetFont}>
                <SelectTrigger id="targetFont">
                  <SelectValue placeholder={t('translateDialog.keepCurrentFonts')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep_current">{t('translateDialog.keepCurrentFonts')}</SelectItem>
                  <SelectGroup>
                    <SelectLabel>{t('properties.fontGroupSystem')}</SelectLabel>
                    {groupedFonts.system.map(font => (
                      <SelectItem key={font.value} value={font.value} style={{ fontFamily: `${font.value}, ${font.category}` }}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t('properties.fontGroupLatin')}</SelectLabel>
                    {groupedFonts.latin.map(font => (
                      <SelectItem key={font.value} value={font.value} style={{ fontFamily: `${font.value}, ${font.category}` }}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t('properties.fontGroupArabic')}</SelectLabel>
                    {groupedFonts.arabic.map(font => (
                      <SelectItem key={font.value} value={font.value} style={{ fontFamily: `${font.value}, ${font.category}` }}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t('properties.fontGroupUrdu')}</SelectLabel>
                    {groupedFonts.urdu.map(font => (
                      <SelectItem key={font.value} value={font.value} style={{ fontFamily: `${font.value}, ${font.category}` }}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t('properties.fontGroupMultilingualFonts')}</SelectLabel>
                    {groupedFonts.multilingual.map(font => (
                      <SelectItem key={font.value} value={font.value} style={{ fontFamily: `${font.value}, ${font.category}` }}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          {scope !== 'element' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <div className="col-start-2 col-span-3 flex flex-col space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="allArtboards"
                    checked={disableAllArtboardsOption ? false : allArtboards}
                    disabled={disableAllArtboardsOption}
                    onCheckedChange={(checked) => setAllArtboards(!!checked)}
                  />
                  <Label htmlFor="allArtboards" className={cn("text-sm font-normal", disableAllArtboardsOption && "opacity-50 cursor-not-allowed")}>
                    {t('translateDialog.translateAllArtboards')}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('translateDialog.rateLimitNote')}
                </p>
              </div>
            </div>
          )}
          {sameLanguage && (
            <p className="text-center text-sm text-destructive">
              {t('translateDialog.sameLanguage', { language: getLanguageName(targetLanguage) })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isTranslating}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleTranslate} disabled={isTranslating || sameLanguage}>
            {isTranslating ? t('translateDialog.translating') : t('translateDialog.translate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
