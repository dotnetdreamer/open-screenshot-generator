// Who is in the room, and what the rest of the app is told about them.

/** One person, as everybody else sees them. */
export interface CollabUser {
  /** Their community account id. Two tabs of one person share it. */
  id: string;
  name: string;
  /** Assigned from the id, so somebody is the same colour to everybody. */
  color: string;
  avatarUrl?: string;
}

/** One connected browser tab. One person with two tabs is two of these. */
export interface CollabPeer {
  /** The Yjs client id, unique per tab and per session. */
  clientId: number;
  user: CollabUser;
  /** What they have selected, which is what the ring on the canvas follows. */
  selection: { artboardId: string | null; elementId: string | null } | null;
  /** Their pointer, in the board's own coordinates. */
  cursor: { artboardId: string; x: number; y: number } | null;
}

export type CollabStatus =
  /** No session. */
  | 'off'
  /** Signalling reached, still looking for the others. */
  | 'connecting'
  /** In the room. */
  | 'live'
  | 'error';

/**
 * Eight colours, picked so a name tag reads on the white of an artboard and on
 * the dark ground around it, and so no two are confusable at cursor size.
 *
 * Assigned from the account id rather than handed out on arrival, which is what
 * makes somebody the same colour in every session and to every peer without
 * anybody coordinating.
 */
const PEER_COLORS = [
  '#0091FF',
  '#E5484D',
  '#30A46C',
  '#8E4EC6',
  '#F76808',
  '#E93D82',
  '#12A594',
  '#FFB224',
];

export function peerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PEER_COLORS[hash % PEER_COLORS.length];
}

/** The first letters of a name, for an avatar with no picture. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
