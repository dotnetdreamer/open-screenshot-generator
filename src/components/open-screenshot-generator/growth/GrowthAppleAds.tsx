"use client";

// Connecting Apple Ads, for keyword popularity (src/lib/growth/appleAds.ts).
// The dialog lays the three steps out together, since the user goes back and
// forth between it and Apple Ads: make a key here, paste its public half into
// Apple Ads, paste back the three ids Apple Ads shows. A key made here is kept
// as a draft from the first click, so closing the dialog half way loses
// nothing. Connect asks Apple for a token and the ad accounts, and saves the
// key only when both answer.
//
// Setup has a panel with the same dialog behind it, and Keywords shows a short
// prompt until Apple Ads is connected.

import React, { useEffect, useRef, useState } from 'react';
import { BarChart3Icon, CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { isTauri, openExternal } from '@/lib/desktop';
import {
  APPLE_ADS_GUIDE_URL,
  APPLE_ADS_URL,
  AppleAdsError,
  appleAdsKeyStamp,
  appleAdsSetupStamp,
  forgetAppleAdsToken,
  freshAppleAdsSetup,
  hasAllIds,
  isAppleAdsConnected,
  parseAppleAdsIds,
  setAppleAdsSetup,
  testAppleAdsKey,
  useAppleAdsSetup,
  type AppleAdsAccount,
  type AppleAdsKey,
  type AppleAdsSetup,
} from '@/lib/growth/appleAds';
import { clearPopularityStatus } from '@/lib/growth/popularityWatch';
import { generateEcKeyPair, publicKeyOf } from '@/lib/publish/jwt';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { Gated, Panel, SectionTitle } from './GrowthShared';

/** Why popularity cannot be connected in this build, or null in the desktop app. */
export function useAppleAdsBlocked(): string | null {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => setDesktop(isTauri()), []);
  return desktop === false ? 'Popularity needs the desktop app' : null;
}

// --- the dialog -----------------------------------------------------------------------------

function StepNumber({ index, done }: { index: number; done: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
        done ? 'border-[hsl(var(--growth-good))] bg-[hsl(var(--growth-good))] text-white' : 'border-border text-muted-foreground'
      )}
      aria-hidden
    >
      {done ? <CheckIcon className="h-3.5 w-3.5" /> : index}
    </span>
  );
}

/** The private key in hand: a draft made but not connected yet, else the saved key. */
function keyInHand(setup: AppleAdsSetup): string | null {
  return setup.draft?.privateKeyPem ?? setup.key?.privateKeyPem ?? null;
}

export function AppleAdsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const setup = useAppleAdsSetup();
  // The key in hand: the draft made here, else the saved one when changing it.
  const privateKeyPem = keyInHand(setup);
  const storedPublicKey = setup.draft?.publicKeyPem ?? setup.key?.publicKeyPem ?? null;
  // A saved key kept without its public half gets it worked out again, so step 1 never asks for a key that exists.
  const [derived, setDerived] = useState<{ from: string; pem: string } | null>(null);
  useEffect(() => {
    if (!open || !privateKeyPem || storedPublicKey) return;
    let cancelled = false;
    void publicKeyOf(privateKeyPem).then(
      (pem) => {
        if (!cancelled) setDerived({ from: privateKeyPem, pem });
      },
      (error) => console.error('Reading the public half of the Apple Ads key failed', error)
    );
    return () => {
      cancelled = true;
    };
  }, [open, privateKeyPem, storedPublicKey]);
  const publicKeyPem = storedPublicKey ?? (derived && derived.from === privateKeyPem ? derived.pem : null);
  const [making, setMaking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ids, setIds] = useState('');
  // The key the IDs box was filled from (appleAdsKeyStamp), or null when the IDs were typed or pasted here.
  const [idsFrom, setIdsFrom] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The ad accounts Apple listed for one key, with that key's stamp: they are offered only while it is the key saved.
  const [accounts, setAccounts] = useState<{ key: string; list: AppleAdsAccount[] } | null>(null);
  // Counts the connections started. Opening or closing the dialog counts too,
  // so a connection still waiting for Apple Ads when the dialog closes saves
  // nothing when its answer comes: by then the user may have disconnected.
  const attempt = useRef(0);
  // Counts the ad account picks, so only the newest one saves.
  const pick = useRef(0);
  // The private key the form is set up for: the key in hand when the dialog opened, or the one this dialog made,
  // read or connected since. Only this dialog moves it, so a key in hand that differs came from another window.
  const [formKey, setFormKey] = useState<string | null>(null);
  // Set up for the dialog open now; false while closed, so a dialog opening never shows the last one's state.
  const [formReady, setFormReady] = useState(false);

  const fillIds = (key: AppleAdsKey | undefined) => {
    setIds(key ? `clientId ${key.clientId}\nteamId ${key.teamId}\nkeyId ${key.keyId}` : '');
    setIdsFrom(appleAdsKeyStamp(key));
  };
  const idsNow = useRef({ ids, idsFrom });
  idsNow.current = { ids, idsFrom };

  // Opening on a saved key shows its ids, so changing one id is one edit. Ids
  // pasted before the dialog was closed stay; ids filled from a key are filled
  // again from the key saved now, which another window may have changed. A
  // list of ad accounts never outlives the dialog.
  useEffect(() => {
    attempt.current += 1;
    setConnecting(false);
    if (!open) {
      setAccounts(null);
      setFormReady(false);
      return;
    }
    setProblem(null);
    setCopied(false);
    const now = freshAppleAdsSetup();
    const typed = idsNow.current.ids.trim() && idsNow.current.idsFrom === null;
    // IDs typed here stay with the key they were typed for; otherwise the form starts from the key in hand now.
    if (!typed) {
      fillIds(now.key);
      setFormKey(keyInHand(now));
    }
    setFormReady(true);
  }, [open]);

  const parsed = parseAppleAdsIds(ids);
  const savedKey = appleAdsKeyStamp(setup.key);
  // The accounts listed here belong to the key this dialog connected. Once another window saves a different key, or
  // removes it, they are not offered: an account of one key must never be saved beside another key.
  const shownAccounts = accounts && accounts.key === savedKey ? accounts.list : null;
  const connected = isAppleAdsConnected(setup) && !setup.draft && shownAccounts !== null;
  // The form no longer fits the setup: another window made, connected or removed a key, so the key in hand, the
  // key the IDs came from, or the key the accounts were listed for is not the one this form is for. Connect would
  // pair one key with another key's IDs, so the dialog says what happened and offers to start from the key saved now.
  const staleFor = (now: AppleAdsSetup) =>
    formKey !== keyInHand(now) ||
    (idsFrom !== null && idsFrom !== appleAdsKeyStamp(now.key)) ||
    (accounts !== null && accounts.key !== appleAdsKeyStamp(now.key));
  const formStale = formReady && staleFor(setup);
  const staleWords =
    setup.draft && setup.draft.privateKeyPem !== formKey
      ? 'Another window made a new Apple Ads key'
      : setup.key
        ? 'Another window connected a different Apple Ads key'
        : 'Another window disconnected Apple Ads';
  const showSavedKey = () => {
    const now = freshAppleAdsSetup();
    // A draft's IDs aren't known here: Apple Ads shows them once its public key is saved there.
    if (now.draft) {
      setIds('');
      setIdsFrom(null);
    } else {
      fillIds(now.key);
    }
    setFormKey(keyInHand(now));
    setAccounts(null);
    setProblem(null);
  };

  const makeKey = async () => {
    setMaking(true);
    setKeyProblem(null);
    try {
      const pair = await generateEcKeyPair();
      setAppleAdsSetup({ draft: { ...pair, madeAt: Date.now() } });
      setFormKey(pair.privateKeyPem);
      setCopied(false);
    } catch (error) {
      console.error('Making an Apple Ads key failed', error);
      setKeyProblem("The key couldn't be made on this computer. Try again");
    } finally {
      setMaking(false);
    }
  };

  const takeOwnKey = async () => {
    setKeyProblem(null);
    try {
      const publicKey = await publicKeyOf(pasted.trim());
      setAppleAdsSetup({ draft: { privateKeyPem: pasted.trim(), publicKeyPem: publicKey, madeAt: Date.now() } });
      setFormKey(pasted.trim());
      setImporting(false);
      setPasted('');
    } catch (error) {
      console.error('Reading a pasted Apple Ads key failed', error);
      setKeyProblem("That private key couldn't be read. Paste the whole key file, with its BEGIN and END lines");
    }
  };

  const copyPublicKey = async () => {
    if (!publicKeyPem) return;
    try {
      await navigator.clipboard.writeText(publicKeyPem);
      setCopied(true);
    } catch (error) {
      console.error('Copying the public key failed', error);
      setKeyProblem('The public key couldn\'t be copied. Select the text in the box and copy it yourself');
    }
  };

  const connect = async () => {
    if (!privateKeyPem || !hasAllIds(parsed)) return;
    // Storage is read first: this window can miss another window's change. Reading it also brings up the note.
    if (staleFor(freshAppleAdsSetup())) return;
    const mine = ++attempt.current;
    // The dialog is modal and its key buttons wait while connecting, so only
    // another window can change the setup meanwhile, and that change wins.
    // The stamps read storage itself: this window may have missed the news.
    const before = appleAdsSetupStamp();
    const changedElsewhere = () => {
      if (appleAdsSetupStamp() === before) return false;
      setProblem('Another window changed Apple Ads while this one was connecting, so nothing was saved');
      return true;
    };
    setConnecting(true);
    setProblem(null);
    const key = { clientId: parsed.clientId, teamId: parsed.teamId, keyId: parsed.keyId, privateKeyPem, ...(publicKeyPem ? { publicKeyPem } : {}) };
    try {
      const found = await testAppleAdsKey(key);
      if (attempt.current !== mine || changedElsewhere()) return;
      const keep = found.find((account) => account.id === setup.account?.id) ?? found[0];
      if (setup.key) forgetAppleAdsToken(setup.key);
      // The old reasons go first: saving the key starts the screens' refreshes, which read them.
      await clearPopularityStatus();
      // Asked again right before saving, so nothing can come between.
      if (attempt.current !== mine || changedElsewhere()) return;
      // A draft is dropped only when it is the key that just connected.
      const draft = freshAppleAdsSetup().draft;
      setAppleAdsSetup({ key, account: keep, draft: draft && draft.privateKeyPem !== privateKeyPem ? draft : null });
      setAccounts({ key: appleAdsKeyStamp(key)!, list: found });
      setIdsFrom(appleAdsKeyStamp(key));
      setFormKey(privateKeyPem);
    } catch (error) {
      if (attempt.current !== mine) return;
      console.error('Connecting Apple Ads failed', error);
      setProblem(error instanceof AppleAdsError ? error.message : "Apple Ads couldn't be reached. Check your connection and try again");
    } finally {
      if (attempt.current === mine) setConnecting(false);
    }
  };

  const connectReason = !privateKeyPem ? 'Make a key first' : !hasAllIds(parsed) ? 'Paste the clientId, teamId and keyId from Apple Ads first' : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="apple-ads-dialog">
        <DialogHeader>
          <DialogTitle>Connect Apple Ads</DialogTitle>
          <DialogDescription>
            Apple Ads gives the words people search on the App Store a popularity score from 1 to 100. Growth shows the score beside your keywords. Growth never
            makes ads and never spends money.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-5">
          <li className="flex gap-3" aria-label="Step 1, make a key">
            <StepNumber index={1} done={!!publicKeyPem} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">Make a key</p>
              {importing ? (
                <div className="space-y-2">
                  <Textarea
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value)}
                    placeholder={'-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----'}
                    aria-label="Your private key"
                    spellCheck={false}
                    className="h-28 font-mono text-[11px]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!pasted.trim() || connecting} onClick={() => void takeOwnKey()}>
                      Use this key
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setImporting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : publicKeyPem ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Here&apos;s the public key for Apple Ads. The private key stays on this computer.</p>
                  <pre className="max-h-28 select-all overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-[11px] text-foreground" data-testid="apple-ads-public-key">
                    {publicKeyPem.trim()}
                  </pre>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={copied ? 'outline' : 'default'} onClick={() => void copyPublicKey()}>
                      {copied ? <CheckIcon className="mr-1.5 h-3.5 w-3.5" /> : <CopyIcon className="mr-1.5 h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy public key'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" disabled={making || connecting} onClick={() => void makeKey()}>
                      Make a new key
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Growth makes the key on this computer. You give Apple Ads the public half, and the private half stays here.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={making || connecting} onClick={() => void makeKey()}>
                      {making ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRoundIcon className="mr-1.5 h-3.5 w-3.5" />}
                      Make a key
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" disabled={connecting} onClick={() => setImporting(true)}>
                      I have a key already
                    </Button>
                  </div>
                </div>
              )}
              {keyProblem && <p className="text-xs text-destructive">{keyProblem}</p>}
            </div>
          </li>

          <li className="flex gap-3" aria-label="Step 2, add the public key in Apple Ads">
            <StepNumber index={2} done={!!publicKeyPem && hasAllIds(parsed)} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-1">
                <p className="text-sm font-medium">Add the public key in Apple Ads</p>
                <InfoTip label="If you don't see API in Apple Ads">
                  <p>Apple Ads shows API only to a user with an API role.</p>
                  <p>An admin of the Apple Ads account can invite you, or another Apple Account of yours, under Account Settings, then User Management. The API Account Read Only role is enough for Growth.</p>
                </InfoTip>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Open Apple Ads and sign in.</li>
                <li>Go to Account Settings, then API.</li>
                <li>Paste the public key into the Public Key box, then click Save.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void openExternal(APPLE_ADS_URL)}>
                  Open Apple Ads
                  <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => void openExternal(APPLE_ADS_GUIDE_URL)}>
                  Apple&apos;s guide
                  <ExternalLinkIcon className="ml-1.5 h-3 w-3" />
                </Button>
              </div>
            </div>
          </li>

          <li className="flex gap-3" aria-label="Step 3, paste the IDs from Apple Ads">
            <StepNumber index={3} done={connected} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">Paste the IDs Apple Ads shows</p>
              <p className="text-xs text-muted-foreground">After you click Save, Apple Ads shows a clientId, a teamId and a keyId above the key. Copy the three lines and paste them here.</p>
              <Textarea
                value={ids}
                onChange={(event) => {
                  setIds(event.target.value);
                  setIdsFrom(null);
                  setProblem(null);
                }}
                placeholder={'clientId SEARCHADS...\nteamId SEARCHADS...\nkeyId ...'}
                aria-label="IDs from Apple Ads"
                spellCheck={false}
                className="h-20 font-mono text-[11px]"
              />
              <ul className="flex flex-wrap gap-1.5" aria-label="IDs found">
                {(
                  [
                    ['clientId', 'Client ID'],
                    ['teamId', 'Team ID'],
                    ['keyId', 'Key ID'],
                  ] as const
                ).map(([field, label]) => (
                  <li
                    key={field}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                      parsed[field] ? 'border-[hsl(var(--growth-good))]/40 text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {parsed[field] ? <CheckIcon className="h-3 w-3 text-[hsl(var(--growth-good))]" aria-hidden /> : <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
                    {label}
                    <span className="sr-only">{parsed[field] ? 'found' : 'missing'}</span>
                  </li>
                ))}
              </ul>
              {formStale ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border p-2.5" role="status" data-testid="apple-ads-key-changed">
                  <p className="text-xs">{staleWords}</p>
                  <Button size="sm" variant="outline" onClick={showSavedKey}>
                    {privateKeyPem ? 'Show that key' : 'Start again'}
                  </Button>
                </div>
              ) : connected ? (
                <div className="space-y-2 rounded-md bg-[hsl(var(--growth-good))]/10 p-2.5" role="status">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--growth-good))]">
                    <CheckIcon className="h-3.5 w-3.5" />
                    Connected to {setup.account?.name}
                  </p>
                  {shownAccounts && accounts && shownAccounts.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs">Read popularity through</span>
                      <Select
                        value={setup.account?.id}
                        onValueChange={(id) => {
                          const account = shownAccounts.find((entry) => entry.id === id);
                          if (!account) return;
                          const mine = ++pick.current;
                          // The list is for one key. Storage is read again first, since this window can miss the news
                          // that another window saved a different key; reading it also takes the list off the screen.
                          if (appleAdsKeyStamp(freshAppleAdsSetup().key) !== accounts.key) return;
                          const before = appleAdsSetupStamp();
                          setProblem(null);
                          // Reasons Apple gave for another account say nothing about this one. While they are cleared,
                          // a newer pick here wins, and so does a key or account another window saved meanwhile.
                          void clearPopularityStatus()
                            .catch((error) => console.error('Clearing the popularity reasons failed', error))
                            .then(() => {
                              if (pick.current !== mine) return;
                              if (appleAdsSetupStamp() !== before) {
                                setProblem("Another window changed Apple Ads meanwhile, so the ad account wasn't changed");
                                return;
                              }
                              setAppleAdsSetup({ account });
                            });
                        }}
                      >
                        <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Ad account">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {shownAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id} className="text-xs">
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button size="sm" onClick={() => onOpenChange(false)}>
                    Done
                  </Button>
                </div>
              ) : (
                <Gated reason={connectReason}>
                  <Button size="sm" disabled={connecting} onClick={() => void connect()}>
                    {connecting && <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {connecting ? 'Connecting' : 'Connect'}
                  </Button>
                </Gated>
              )}
              {problem && (
                <p className="text-xs text-destructive" role="alert">
                  {problem}
                </p>
              )}
            </div>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

// --- Setup -----------------------------------------------------------------------------------

/** Setup's panel: connect, see which account popularity is read through, change or remove the key. */
export function AppleAdsPanel() {
  const setup = useAppleAdsSetup();
  const blocked = useAppleAdsBlocked();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connected = isAppleAdsConnected(setup);
  return (
    <Panel data-testid="growth-apple-ads">
      <SectionTitle title="Apple Ads, for keyword popularity" hint="Growth reads the popularity score of your keywords. Growth never makes ads or spends money." />
      {connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-2">
                <KeyRoundIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                Connected to {setup.account?.name}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{setup.key?.clientId}</p>
            </div>
            <div className="flex gap-2">
              <Gated reason={blocked}>
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                  Change key
                </Button>
              </Gated>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                Disconnect
              </Button>
            </div>
          </div>
          {confirm && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Remove the Apple Ads key from this computer?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (setup.key) forgetAppleAdsToken(setup.key);
                  setAppleAdsSetup({ key: null, account: null, draft: null });
                  void clearPopularityStatus();
                  setConfirm(false);
                }}
              >
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Keep
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Gated reason={blocked}>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <BarChart3Icon className="mr-1.5 h-4 w-4" />
            {setup.draft ? 'Finish connecting Apple Ads' : 'Connect Apple Ads'}
          </Button>
        </Gated>
      )}
      <p className="mt-3 text-xs text-muted-foreground">The key stays on your computer and goes only to Apple.</p>
      <AppleAdsDialog open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

// --- Keywords' prompt -----------------------------------------------------------------------

const PROMPT_KEY = 'open-screenshot-generator.growth.popularity-prompt';

function promptHidden(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_KEY) === 'hidden';
  } catch {
    return false;
  }
}

/**
 * The line Keywords shows until Apple Ads is connected. `always` keeps it on
 * screen, for the map, which needs popularity. The dialog belongs to the
 * screen (`onConnect` opens it), since this line goes the moment Apple Ads
 * is connected, and the dialog has to stay to say so.
 */
export function PopularityPrompt({ always = false, onConnect }: { always?: boolean; onConnect: () => void }) {
  const setup = useAppleAdsSetup();
  const blocked = useAppleAdsBlocked();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(promptHidden()), []);
  if (isAppleAdsConnected(setup) || (hidden && !always)) return null;
  return (
    <div
      className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-[hsl(var(--growth-series))]/30 bg-[hsl(var(--growth-series))]/5 p-3', always && 'mx-4 mb-4')}
      data-testid="growth-popularity-prompt"
    >
      <BarChart3Icon className="h-5 w-5 shrink-0 text-[hsl(var(--growth-series))]" aria-hidden />
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{always ? 'The map needs popularity from Apple Ads' : 'See how popular each keyword is'}</p>
        <p className="text-xs text-muted-foreground">Apple Ads gives each keyword a popularity score from 1 to 100 in each country. Growth shows the score beside each rank.</p>
      </div>
      <Gated reason={blocked}>
        <Button size="sm" onClick={onConnect}>
          {setup.draft ? 'Finish connecting Apple Ads' : 'Connect Apple Ads'}
        </Button>
      </Gated>
      {!always && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground"
          aria-label="Hide this for now"
          title="Hide this for now. Setup has Apple Ads too"
          onClick={() => {
            try {
              window.localStorage.setItem(PROMPT_KEY, 'hidden');
            } catch {
              // Private mode: hidden until reload.
            }
            setHidden(true);
          }}
        >
          <XIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
