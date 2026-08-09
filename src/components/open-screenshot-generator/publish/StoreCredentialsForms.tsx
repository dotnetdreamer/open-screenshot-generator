"use client";

// The two credential forms behind the publish dialog.
//
// Both stores authenticate a machine, not a person, so there is no sign-in
// popup to lean on: the user fetches a key file from a developer console and
// brings it here. Getting that key is the genuinely fiddly part of this
// feature, so the numbered steps live in the form itself rather than only in
// docs/STORE-UPLOAD.md. Keys are held in localStorage on this machine only,
// and the forms say that out loud rather than implying a vault.
//
// The key file is read through a plain <input type="file">, NOT the Tauri
// dialog + fs plugin. readTextFile needs `fs:allow-read-text-file`, which the
// capability does not grant (it has `fs:allow-read-file`, a different
// permission), and the denial surfaces as a file-read error rather than a
// permission one. A file input needs no permission, needs no Rust rebuild to
// change, and works identically in the browser. Same approach the screenshot
// uploader already uses.

import React, { useRef, useState } from 'react';
import { CheckIcon, CopyIcon, ExternalLinkIcon, FileKeyIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { openExternal } from '@/lib/desktop';
import { parseServiceAccount, type AppStoreCredentials, type PlayCredentials } from '@/lib/publish';

const APP_STORE_KEY_URL = 'https://appstoreconnect.apple.com/access/integrations/api';
const PLAY_API_ACCESS_URL = 'https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com';
const PLAY_SERVICE_ACCOUNTS_URL = 'https://console.cloud.google.com/iam-admin/serviceaccounts';
const PLAY_API_GUIDE_URL = 'https://developers.google.com/android-publisher/getting_started';

/** One numbered instruction, plus the "why" that stops people getting stuck. */
interface SetupStep {
  text: string;
  detail?: string;
}

const APP_STORE_STEPS: SetupStep[] = [
  {
    text: 'In App Store Connect open Users and Access, then the Integrations tab, then App Store Connect API',
    detail: 'Team keys sit at account level, not inside any one app',
  },
  {
    text: 'Under Team Keys click the plus, name the key, and give it the App Manager or Developer role',
    detail:
      'A weaker role signs in fine but is refused when it tries to write screenshots, and the error looks identical to a bad key',
  },
  {
    text: 'Copy the Issuer ID shown above the key list into the field below',
    detail: 'One issuer id covers the whole team, so it is the same for every key you make',
  },
  { text: 'Copy the Key ID from the row of the key you just created' },
  {
    text: 'Download AuthKey_<KeyID>.p8 and choose it below',
    detail: 'Apple lets you download it exactly once. Keep a copy somewhere safe, because a lost key can only be replaced, not re-downloaded.',
  },
];

// Google dropped the "link a Cloud project" step and moved API access out of
// the old Setup menu, so these deliberately start in Google Cloud and use
// Users and permissions, which is still in the Play Console sidebar.
const PLAY_STEPS: SetupStep[] = [
  {
    text: 'In Google Cloud Console create or pick a project, then enable the Google Play Android Developer API',
    detail:
      'This is the API that uploads your listing images. Any project will do, and it no longer has to be linked to your Play developer account.',
  },
  {
    text: 'Open IAM and Admin, then Service Accounts, and click Create service account',
    detail:
      'A service account is a robot Google account with its own email address. It does the uploading for you, so nothing depends on your personal login and you can revoke it on its own later. Look under IAM and Admin, not under APIs and Services where you just enabled the API.',
  },
  {
    text: 'Open the new account, go to its Keys tab, then Add key, Create new key, and pick JSON',
    detail:
      'That JSON file is the password for the account, so keep it safe. You can skip the optional "grant this service account access to the project" step, because Cloud roles are not what grants Play access.',
  },
  {
    text: 'Copy the account address, then in Play Console open Users and permissions and click Invite new users',
    detail:
      'The address is the Email field on the account Details tab, and it ends in .iam.gserviceaccount.com. Load the JSON below first and it is shown here with a copy button. Until it is invited, Google Play does not know the account exists and every upload comes back 403.',
  },
  {
    text: 'Under App permissions add this app, tick the store presence permissions, then click Invite user',
    detail:
      'Store presence is the group covering the listing, which is where screenshots live. Nothing is applied until you click Invite user at the bottom of that page.',
  },
  {
    text: 'Come back here, choose the JSON file below, and enter the package name of the app',
    detail: 'The package name looks like com.example.app and has to match the app exactly',
  },
];

function HelpLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-xs"
      onClick={() => void openExternal(url)}
    >
      {children}
      <ExternalLinkIcon className="ml-1 h-3 w-3" />
    </Button>
  );
}

/**
 * The service account address, with one-click copy.
 *
 * This is the value Play Console's "Invite new users" field wants, and hunting
 * for it in Google Cloud (it is the Email field on the account's Details tab,
 * not the numeric id in the breadcrumb) is a real stumbling block. We already
 * parse it out of the key file, so it may as well be handed over here.
 *
 * Two ways out on purpose, because neither can be fully trusted:
 * navigator.clipboard.writeText is blocked in some contexts (it throws
 * NotAllowedError under a headless engine even with permissions granted), and
 * the execCommand fallback reports true whether or not anything reached the
 * clipboard, so the "Copied" label is a best effort, not proof. The address
 * itself therefore carries `select-all`: one click selects the whole thing, so
 * a plain Ctrl+C always works even when both clipboard paths do nothing.
 */
function CopyableEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await (async () => {
      try {
        await navigator.clipboard.writeText(email);
        return true;
      } catch {
        try {
          const scratch = document.createElement('textarea');
          scratch.value = email;
          scratch.style.position = 'fixed';
          scratch.style.opacity = '0';
          document.body.appendChild(scratch);
          scratch.select();
          const done = document.execCommand('copy');
          scratch.remove();
          return done;
        } catch {
          return false;
        }
      }
    })();
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex items-center gap-1.5">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        Publishes as{' '}
        <span
          className="select-all font-mono"
          title="Click to select the whole address, then copy it"
        >
          {email}
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={copy}
        title="Copy this address to paste into Play Console"
      >
        {copied ? (
          <>
            <CheckIcon className="mr-1 h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <CopyIcon className="mr-1 h-3 w-3" />
            Copy
          </>
        )}
      </Button>
    </div>
  );
}

function Steps({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-4 text-xs marker:font-medium marker:text-muted-foreground">
      {steps.map((step) => (
        <li key={step.text}>
          <span className="text-foreground">{step.text}</span>
          {step.detail && <span className="mt-0.5 block text-muted-foreground">{step.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Hidden file input plus its trigger button. Returns the file's text, which is
 * all either credential needs.
 */
function useTextFilePicker(onLoaded: (name: string, contents: string) => void, onError: (message: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = () => inputRef.current?.click();
  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset first so picking the same file twice still fires a change event.
    event.target.value = '';
    if (!file) return;
    try {
      onLoaded(file.name, await file.text());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'That file could not be read.');
    }
  };
  return { inputRef, open, handleChange };
}

export function AppStoreCredentialsForm({
  value,
  onSave,
  onCancel,
}: {
  value?: AppStoreCredentials;
  onSave: (credentials: AppStoreCredentials) => void;
  onCancel?: () => void;
}) {
  const [issuerId, setIssuerId] = useState(value?.issuerId ?? '');
  const [keyId, setKeyId] = useState(value?.keyId ?? '');
  const [privateKey, setPrivateKey] = useState(value?.privateKey ?? '');
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const picker = useTextFilePicker((name, contents) => {
    setError(null);
    setPrivateKey(contents);
    setPickedName(name);
    // Apple names the download AuthKey_<KEYID>.p8, so the key id is free.
    const match = /AuthKey_([A-Z0-9]+)\.p8$/i.exec(name);
    if (match && !keyId.trim()) setKeyId(match[1]);
  }, setError);

  const submit = () => {
    if (!issuerId.trim() || !keyId.trim() || !privateKey.trim()) {
      setError('All three fields are needed');
      return;
    }
    if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(privateKey)) {
      setError('The private key should start with a BEGIN PRIVATE KEY line. Paste the whole .p8 file');
      return;
    }
    onSave({ issuerId: issuerId.trim(), keyId: keyId.trim(), privateKey });
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Get an App Store Connect API key</p>
          <HelpLink url={APP_STORE_KEY_URL}>Open the keys page</HelpLink>
        </div>
        <Steps steps={APP_STORE_STEPS} />
        <p className="text-xs text-muted-foreground">
          The key is stored on this computer only, the same as your AI provider keys. It goes to
          Apple and nowhere else.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="asc-issuer" className="text-xs">
            Issuer ID
          </Label>
          <Input
            id="asc-issuer"
            value={issuerId}
            autoComplete="off"
            spellCheck={false}
            placeholder="69a6de70-..."
            onChange={(event) => setIssuerId(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asc-key-id" className="text-xs">
            Key ID
          </Label>
          <Input
            id="asc-key-id"
            value={keyId}
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD123456"
            onChange={(event) => setKeyId(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="asc-private-key" className="text-xs">
            Private key (.p8)
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">or paste it below</span>
            <Button variant="outline" size="sm" className="h-7" onClick={picker.open}>
              <FileKeyIcon className="mr-1.5 h-3.5 w-3.5" />
              Choose file
            </Button>
          </div>
        </div>
        <input
          ref={picker.inputRef}
          type="file"
          accept=".p8,application/x-pem-file,text/plain"
          className="hidden"
          onChange={picker.handleChange}
        />
        <Textarea
          id="asc-private-key"
          value={privateKey}
          spellCheck={false}
          rows={4}
          className="text-xs"
          placeholder={'-----BEGIN PRIVATE KEY-----\n...'}
          onChange={(event) => {
            setPrivateKey(event.target.value);
            setPickedName(null);
          }}
        />
        {pickedName && <p className="text-xs text-muted-foreground">Loaded {pickedName}</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={submit}>
          Save key
        </Button>
      </div>
    </div>
  );
}

export function PlayCredentialsForm({
  value,
  onSave,
  onCancel,
}: {
  value?: PlayCredentials;
  onSave: (credentials: PlayCredentials) => void;
  onCancel?: () => void;
}) {
  const [packageName, setPackageName] = useState(value?.packageName ?? '');
  const [serviceAccountJson, setServiceAccountJson] = useState(value?.serviceAccountJson ?? '');
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const picker = useTextFilePicker((name, contents) => {
    setError(null);
    setServiceAccountJson(contents);
    setPickedName(name);
  }, setError);

  const submit = () => {
    if (!packageName.trim()) {
      setError('Enter the package name of the app');
      return;
    }
    try {
      parseServiceAccount(serviceAccountJson);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'That key file is not valid.');
      return;
    }
    onSave({ packageName: packageName.trim(), serviceAccountJson });
  };

  const email = (() => {
    try {
      return parseServiceAccount(serviceAccountJson).client_email;
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Get a Google Play service account key</p>
          <div className="flex shrink-0 items-center gap-3">
            <HelpLink url={PLAY_API_ACCESS_URL}>Enable the API</HelpLink>
            <HelpLink url={PLAY_SERVICE_ACCOUNTS_URL}>Service accounts</HelpLink>
          </div>
        </div>
        <Steps steps={PLAY_STEPS} />
        <div className="flex flex-wrap items-center gap-x-3">
          <HelpLink url={PLAY_API_GUIDE_URL}>Google&apos;s full setup guide</HelpLink>
          <span className="text-xs text-muted-foreground">
            Stored on this computer only, and sent to Google alone
          </span>
        </div>
      </div>

      {/* Key first, package name second: that is the order the steps describe,
          and it keeps "Choose file" from being the lowest thing in a form that
          already scrolls. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="play-json" className="text-xs">
            Service account JSON
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">or paste it below</span>
            <Button variant="outline" size="sm" className="h-7" onClick={picker.open}>
              <UploadIcon className="mr-1.5 h-3.5 w-3.5" />
              Choose file
            </Button>
          </div>
        </div>
        <input
          ref={picker.inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={picker.handleChange}
        />
        <Textarea
          id="play-json"
          value={serviceAccountJson}
          spellCheck={false}
          rows={4}
          className="text-xs"
          placeholder={'{ "type": "service_account", ... }'}
          onChange={(event) => {
            setServiceAccountJson(event.target.value);
            setPickedName(null);
          }}
        />
        {pickedName && <p className="text-xs text-muted-foreground">Loaded {pickedName}</p>}
        {email && <CopyableEmail email={email} />}
      </div>

      <div className="space-y-1">
        <Label htmlFor="play-package" className="text-xs">
          Package name
        </Label>
        <Input
          id="play-package"
          value={packageName}
          autoComplete="off"
          spellCheck={false}
          placeholder="com.example.app"
          onChange={(event) => setPackageName(event.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" onClick={submit}>
          Save key
        </Button>
      </div>
    </div>
  );
}
