"use client";

// An author's picture, or a stable initials chip when there is none.
//
// Nothing is fetched from an avatar service: the app runs offline, inside the
// Tauri webview, and under a strict static export, so the fallback has to be
// drawn locally. The gradient is derived from the author id, which keeps a
// given person looking the same everywhere in the feed.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { avatarGradient, initialsOf } from '@/lib/discover/format';
import type { DiscoverAuthor } from '@/types/discover';

interface AuthorAvatarProps {
  author: DiscoverAuthor;
  className?: string;
}

export function AuthorAvatar({ author, className }: AuthorAvatarProps) {
  return (
    <Avatar className={cn('h-9 w-9 border border-border/60', className)}>
      {author.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
      <AvatarFallback
        className="text-[11px] font-semibold text-white"
        style={{ backgroundImage: avatarGradient(author.id) }}
      >
        {initialsOf(author.name)}
      </AvatarFallback>
    </Avatar>
  );
}
