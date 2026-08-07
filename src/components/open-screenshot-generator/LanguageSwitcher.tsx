"use client";

// Compact locale picker living in the sidebar footer next to Account/About.
// Globe + the active locale's own name (locale names stay in their own
// language, the standard convention), opening a small menu with a check on
// the current choice.

import { CheckIcon, GlobeIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { LOCALES, useLocale, useT } from '@/i18n';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const active = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip={t('languageSwitcher.label')} className="w-full">
          <GlobeIcon />
          <span className="truncate group-data-[collapsible=icon]:hidden">{active.label}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-[10rem]">
        <DropdownMenuLabel className="text-xs">{t('languageSwitcher.label')}</DropdownMenuLabel>
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => setLocale(option.id)}
            aria-checked={locale === option.id}
            role="menuitemradio"
          >
            <CheckIcon
              className={cn('mr-2 h-4 w-4', locale === option.id ? 'opacity-100' : 'opacity-0')}
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
