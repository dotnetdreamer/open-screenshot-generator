// A phone linked to Director, so the phone in the film moves the way the
// phone in someone's hand moves. Nothing to install: the phone opens a page of
// this app (/remote) from a QR code, and the two meet in a room on the live
// editing server (infra/vps/mcp-relay/src/collab.js), which introduces them.
//
// The readings then go straight from the phone to the computer over a WebRTC
// data channel, which on the same Wi-Fi takes a few milliseconds. When no
// direct path opens (some networks block it), they go through the server
// instead, fewer of them a second. The server only copies messages between the
// two sockets in a room whose id is a random 128-bit number from the QR code.
//
// Every message names its sender, because the server sends a room's messages
// to everybody in it, the sender too.

import { BASE_PATH } from '@/lib/basePath';
import { isTauri } from '@/lib/desktop';
import type { Quat } from './motion';

const RELAY = (process.env.NEXT_PUBLIC_COLLAB_URL ?? process.env.NEXT_PUBLIC_MCP_RELAY_URL ?? '').trim().replace(/\/+$/, '');
const TURN_ENDPOINT = (process.env.NEXT_PUBLIC_TURN_ENDPOINT ?? '').trim();
const STUN_URLS = (process.env.NEXT_PUBLIC_STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
/** The editor on the web, for the code the desktop app shows: a phone can't open the app's own pages. */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://editor.openscrgen.app').trim().replace(/\/+$/, '');

/** How long a direct path gets to open before the readings go through the server. */
const DIRECT_WAIT_MS = 6000;
/** Readings a second through the server; a direct path takes every one. */
const RELAYED_PER_SECOND = 30;

export function isLinkConfigured(): boolean {
  return !!RELAY;
}

export class LinkSignInRequired extends Error {
  constructor() {
    super('Sign in to connect a phone');
  }
}

/** A short-lived pass to the server, made with the account's sign-in. The server may run without sign-in, then it's null. */
export async function getTicket(token: string | null): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${RELAY}/collab/ticket`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new Error("The connection server couldn't be reached. Check your internet connection.");
  }
  if (response.status === 401) throw new LinkSignInRequired();
  if (!response.ok) throw new Error('The connection server turned the phone link down. Try again in a moment.');
  const payload = (await response.json().catch(() => ({}))) as { ticket?: string };
  return payload.ticket ?? null;
}

async function iceServers(): Promise<RTCIceServer[]> {
  const base: RTCIceServer[] = STUN_URLS.length ? [{ urls: STUN_URLS }] : [];
  if (!TURN_ENDPOINT) return base;
  try {
    const response = await fetch(TURN_ENDPOINT);
    if (!response.ok) return base;
    const payload = (await response.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(payload.iceServers) && payload.iceServers.length ? payload.iceServers : base;
  } catch {
    return base;
  }
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => v.toString(16).padStart(2, '0')).join('');
}

/** The page the phone opens, with the room and the pass in the part after #, which never reaches a server. */
export function remotePageUrl(room: string, ticket: string | null): string {
  const origin = isTauri() || typeof window === 'undefined' ? SITE_URL : `${window.location.origin}${BASE_PATH}`;
  const fragment = new URLSearchParams({ r: room, ...(ticket ? { t: ticket } : {}) }).toString();
  return `${origin}/remote#${fragment}`;
}

/** The room and pass from the phone page's address. */
export function readRemoteFragment(hash: string): { room: string; ticket: string | null } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const room = params.get('r');
  if (!room || !/^[0-9a-f]{32}$/.test(room)) return null;
  return { room, ticket: params.get('t') };
}

/** A reading from the phone: its turn since it was centred, and the pinch. */
export interface MotionReading {
  q: Quat;
  zoom: number;
}

export type LinkMessage =
  | { kind: 'hello'; from: string; device?: string }
  | { kind: 'welcome'; from: string; to: string }
  | { kind: 'offer' | 'answer'; from: string; to: string; sdp: string }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { kind: 'm'; from: string; q: Quat; z: number }
  | { kind: 'record'; from: string; on: boolean }
  | { kind: 'state'; from: string; recording: boolean; playing: boolean; t: number; duration: number }
  | { kind: 'bye'; from: string };

export type LinkStatus =
  /** Getting a pass and joining the room. */
  | 'starting'
  /** In the room, nobody else there yet. */
  | 'waiting'
  /** Linked: readings go straight between the two. */
  | 'direct'
  /** Linked: readings go through the server. */
  | 'relayed'
  | 'closed'
  | 'failed';

export interface LinkEvents {
  onStatus?: (status: LinkStatus, detail?: string) => void;
  onMotion?: (reading: MotionReading) => void;
  onRecord?: (on: boolean) => void;
  onState?: (state: { recording: boolean; playing: boolean; t: number; duration: number }) => void;
  /** The other side left or a new phone took over. */
  onPeer?: (present: boolean, device?: string) => void;
}

/**
 * One side of a link: the computer ('desk'), which makes the room and waits,
 * or the phone, which joins it. The desk starts the direct path when a phone
 * says hello; a second phone that joins takes over from the first.
 */
export class RoomLink {
  readonly room: string;
  readonly id = randomHex(8);
  private socket: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private peer: string | null = null;
  private status: LinkStatus = 'starting';
  private closed = false;
  private directTimer = 0;
  private lastRelayed = 0;
  private pendingIce: RTCIceCandidateInit[] = [];
  private reconnects = 0;

  constructor(
    readonly role: 'desk' | 'phone',
    private readonly ticket: string | null,
    private readonly events: LinkEvents,
    room?: string
  ) {
    this.room = room ?? randomHex(16);
  }

  get topic(): string {
    return `osg-director:${this.room}`;
  }

  get currentStatus(): LinkStatus {
    return this.status;
  }

  private setStatus(status: LinkStatus, detail?: string) {
    if (this.status === status && !detail) return;
    this.status = status;
    this.events.onStatus?.(status, detail);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const base = RELAY.replace(/^http/, 'ws');
      const url = this.ticket ? `${base}/collab?t=${encodeURIComponent(this.ticket)}` : `${base}/collab`;
      let opened = false;
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        opened = true;
        this.reconnects = 0;
        socket.send(JSON.stringify({ type: 'subscribe', topics: [this.topic] }));
        if (this.role === 'phone') this.publish({ kind: 'hello', from: this.id, device: navigator.userAgent.slice(0, 120) });
        if (!this.peer) this.setStatus('waiting');
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; topic?: string; data?: LinkMessage };
          if (message.type === 'publish' && message.topic === this.topic && message.data) this.receive(message.data);
        } catch {
          // Not ours: ignore it.
        }
      };
      socket.onclose = () => {
        if (this.closed) return;
        if (!opened) {
          this.setStatus('failed', "The connection server couldn't be reached.");
          reject(new Error("The connection server couldn't be reached. Check your internet connection."));
          return;
        }
        // A blip: join again with the same pass, a few times.
        if (this.reconnects < 4) {
          this.reconnects += 1;
          setTimeout(() => {
            if (!this.closed) this.connect().catch(() => undefined);
          }, 800 * this.reconnects);
        } else if (!this.channel || this.channel.readyState !== 'open') {
          this.setStatus('failed', 'The link to the connection server dropped.');
        }
      };
    });
  }

  private publish(data: LinkMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'publish', topic: this.topic, data }));
    }
  }

  /** Sends over the direct path when it's open, else through the server. */
  private send(data: LinkMessage, frequent = false) {
    if (this.channel?.readyState === 'open') {
      try {
        this.channel.send(JSON.stringify(data));
        return;
      } catch {
        // Fall through to the server.
      }
    }
    if (frequent) {
      const now = performance.now();
      if (now - this.lastRelayed < 1000 / RELAYED_PER_SECOND) return;
      this.lastRelayed = now;
    }
    this.publish(data);
  }

  private receive(message: LinkMessage) {
    if (message.from === this.id) return;
    if ('to' in message && message.to !== this.id) return;
    switch (message.kind) {
      case 'hello':
        if (this.role !== 'desk') return;
        // A new phone takes over: the last one's path is closed.
        this.dropPath();
        this.peer = message.from;
        this.events.onPeer?.(true, message.device);
        this.publish({ kind: 'welcome', from: this.id, to: message.from });
        void this.offer();
        return;
      case 'welcome':
        if (this.role !== 'phone') return;
        this.peer = message.from;
        this.events.onPeer?.(true);
        this.armFallback();
        return;
      case 'offer':
        if (this.role !== 'phone') return;
        void this.answer(message.sdp);
        return;
      case 'answer':
        if (this.role !== 'desk' || !this.pc) return;
        void this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }).then(() => this.flushIce()).catch(() => undefined);
        return;
      case 'ice':
        if (!this.pc || !this.pc.remoteDescription) this.pendingIce.push(message.candidate);
        else void this.pc.addIceCandidate(message.candidate).catch(() => undefined);
        return;
      default:
        this.handle(message);
    }
  }

  /** Messages that arrive by either path. */
  private handle(message: LinkMessage) {
    if (message.from === this.id) return;
    switch (message.kind) {
      case 'm':
        this.events.onMotion?.({ q: message.q, zoom: message.z });
        return;
      case 'record':
        this.events.onRecord?.(message.on);
        return;
      case 'state':
        this.events.onState?.({ recording: message.recording, playing: message.playing, t: message.t, duration: message.duration });
        return;
      case 'bye':
        if (message.from === this.peer) {
          this.dropPath();
          this.peer = null;
          this.events.onPeer?.(false);
          this.setStatus('waiting');
        }
        return;
    }
  }

  private async flushIce() {
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of pending) await this.pc?.addIceCandidate(candidate).catch(() => undefined);
  }

  private armFallback() {
    clearTimeout(this.directTimer);
    this.setStatus('relayed');
    this.directTimer = window.setTimeout(() => {
      if (this.channel?.readyState !== 'open') this.setStatus('relayed');
    }, DIRECT_WAIT_MS);
  }

  private async newPeerConnection(): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({ iceServers: await iceServers() });
    pc.onicecandidate = (event) => {
      if (event.candidate && this.peer) this.publish({ kind: 'ice', from: this.id, to: this.peer, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // The server still carries everything.
        if (this.peer) this.setStatus('relayed');
      }
    };
    return pc;
  }

  private useChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      if (channel !== this.channel) return;
      clearTimeout(this.directTimer);
      this.setStatus('direct');
    };
    channel.onclose = () => {
      if (channel !== this.channel) return;
      if (this.peer && !this.closed) this.setStatus('relayed');
    };
    channel.onmessage = (event) => {
      try {
        this.handle(JSON.parse(String(event.data)) as LinkMessage);
      } catch {
        // ignore
      }
    };
  }

  private async offer() {
    const peer = this.peer;
    if (!peer || typeof RTCPeerConnection === 'undefined') {
      this.setStatus('relayed');
      return;
    }
    this.armFallback();
    try {
      const pc = await this.newPeerConnection();
      this.pc = pc;
      this.useChannel(pc.createDataChannel('motion', { ordered: false, maxRetransmits: 0 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.peer === peer) this.publish({ kind: 'offer', from: this.id, to: peer, sdp: offer.sdp ?? '' });
    } catch {
      this.setStatus('relayed');
    }
  }

  private async answer(sdp: string) {
    const peer = this.peer;
    if (!peer || typeof RTCPeerConnection === 'undefined') return;
    try {
      this.dropPath();
      const pc = await this.newPeerConnection();
      this.pc = pc;
      pc.ondatachannel = (event) => this.useChannel(event.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.publish({ kind: 'answer', from: this.id, to: peer, sdp: answer.sdp ?? '' });
    } catch {
      this.setStatus('relayed');
    }
  }

  private dropPath() {
    clearTimeout(this.directTimer);
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    this.pendingIce = [];
  }

  sendMotion(reading: MotionReading): void {
    const q = reading.q.map((v) => Math.round(v * 1e4) / 1e4) as Quat;
    this.send({ kind: 'm', from: this.id, q, z: Math.round(reading.zoom * 1000) / 1000 }, true);
  }

  sendRecord(on: boolean): void {
    this.send({ kind: 'record', from: this.id, on });
  }

  sendState(state: { recording: boolean; playing: boolean; t: number; duration: number }): void {
    this.send({ kind: 'state', from: this.id, ...state }, true);
  }

  close(): void {
    if (this.closed) return;
    this.publish({ kind: 'bye', from: this.id });
    this.closed = true;
    this.dropPath();
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
    this.setStatus('closed');
  }
}
