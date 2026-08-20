"use client";

// One person in a session, as a face.
//
// The picture is the nice-to-have and the initials are the real thing. A
// GitHub account may have no avatar at all, a Google one may have a URL that a
// network blocks, and a picture that fails to load leaves the browser's broken
// image glyph, which is worse than no picture at all: it reads as a bug rather
// than as a person. So the initials are drawn first, in the colour that person
// carries everywhere else in the session, and the picture is only ever laid
// over them once it has actually loaded.

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { initialsOf, type CollabUser } from '@/lib/collab/types';

interface CollabFaceProps {
  user: CollabUser;
  /** Shown on hover, and read out. */
  title?: string;
  className?: string;
}

export function CollabFace({ user, title, className }: CollabFaceProps) {
  const [failed, setFailed] = useState(false);
  // A different person (or the same one with a new picture) starts again.
  useEffect(() => setFailed(false), [user.avatarUrl]);

  const showImage = !!user.avatarUrl && !failed;

  return (
    <span
      title={title ?? user.name}
      className={cn(
        'relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white',
        className
      )}
      style={{ background: user.color }}
    >
      {initialsOf(user.name)}
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      )}
    </span>
  );
}
