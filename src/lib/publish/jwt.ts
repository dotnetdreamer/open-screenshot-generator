// Signed JWTs for the store APIs and Apple Ads, using WebCrypto only.
//
// Each one authenticates a machine, not a person, with a short-lived
// self-signed JWT:
//
//   App Store Connect  ES256 over a P-256 key, `aud: appstoreconnect-v1`
//   Google Play        RS256 over the service account key, exchanged at
//                      oauth2.googleapis.com for a real access token
//   Apple Ads          ES256 over a P-256 key, `aud: https://appleid.apple.com`,
//                      exchanged at appleid.apple.com for an access token
//
// The store keys arrive as PKCS#8 PEM (Apple's .p8 file, and the
// `private_key` field inside a Google service account JSON). An Apple Ads key
// is one the app made (PKCS#8) or one made with OpenSSL as Apple's guide
// shows, which writes an "EC PRIVATE KEY" (SEC1) that is wrapped as PKCS#8
// before WebCrypto sees it. WebCrypto's ECDSA signatures are already raw
// r||s, which is exactly what JWS ES256 wants, so nothing has to unpack DER.

/** Base64url with the padding stripped, per RFC 7515. */
function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCS#8 PEM to DER bytes.
 *
 * Accepts a key pasted with literal "\n" escapes as well as real newlines:
 * that is what happens when someone copies the `private_key` value out of a
 * service account JSON by hand instead of pasting the whole file.
 */
export function pemToDer(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const body = normalized
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('That private key looks empty.');
  let binary: string;
  try {
    binary = atob(body);
  } catch {
    throw new Error('That private key is not valid PEM. Paste the whole file, headers included.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One DER element at `at`: its tag, where its body starts and ends. */
function derElement(der: Uint8Array, at: number): { tag: number; start: number; end: number } {
  let length = der[at + 1];
  let header = 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let index = 0; index < bytes; index += 1) length = length * 256 + der[at + 2 + index];
    header += bytes;
  }
  if (at + header + length > der.length) throw new Error('truncated');
  return { tag: der[at], start: at + header, end: at + header + length };
}

function derEncode(tag: number, body: Uint8Array): Uint8Array {
  const length = body.length;
  const header = length < 0x80 ? [tag, length] : length < 0x100 ? [tag, 0x81, length] : [tag, 0x82, length >> 8, length & 0xff];
  const out = new Uint8Array(header.length + length);
  out.set(header);
  out.set(body, header.length);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function derChildren(der: Uint8Array, start: number, end: number): Uint8Array[] {
  const children: Uint8Array[] = [];
  for (let at = start; at < end; ) {
    const element = derElement(der, at);
    children.push(der.subarray(at, element.end));
    at = element.end;
  }
  return children;
}

/**
 * An EC PKCS#8 key without the curve inside its ECPrivateKey, or null when it
 * has none there. Apple's .p8 files repeat the curve as the optional
 * `[0] parameters` field (RFC 5915), and WebKit's WebCrypto refuses a key
 * carrying it with a DataError, so the macOS app could not read any App Store
 * Connect key. The curve is also in the key's algorithm identifier, which is
 * where WebCrypto reads it, so leaving the field out changes nothing else.
 * Exported for tests.
 */
export function withoutEcParameters(der: Uint8Array): Uint8Array | null {
  try {
    const outer = derElement(der, 0);
    const [version, algorithm, octets, ...rest] = derChildren(der, outer.start, outer.end);
    if (!octets || octets[0] !== 0x04) return null;
    const wrapped = derElement(octets, 0);
    const ecKey = derElement(octets, wrapped.start);
    if (ecKey.tag !== 0x30) return null;
    const fields = derChildren(octets, ecKey.start, ecKey.end);
    const kept = fields.filter((field) => field[0] !== 0xa0);
    if (kept.length === fields.length) return null;
    const inner = derEncode(0x04, derEncode(0x30, concatBytes(kept)));
    return derEncode(0x30, concatBytes([version, algorithm, inner, ...rest]));
  } catch {
    return null;
  }
}

/** A PKCS#8 key's version and algorithm for P-256: 0, then id-ecPublicKey with prime256v1. */
const P256_PKCS8_HEAD = new Uint8Array([
  0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
]);

/**
 * An "EC PRIVATE KEY" (SEC1, RFC 5915) as a PKCS#8 key, the one EC private
 * key form WebCrypto imports. `openssl ecparam -genkey`, the command in
 * Apple's Apple Ads guide, writes SEC1. Exported for tests.
 */
export function sec1ToPkcs8(sec1: Uint8Array): Uint8Array {
  return derEncode(0x30, concatBytes([P256_PKCS8_HEAD, derEncode(0x04, sec1)]));
}

/**
 * The DER bytes of a private key PEM, as PKCS#8 whichever of the two forms it
 * came in. `openssl ecparam -genkey` without `-noout` writes an "EC
 * PARAMETERS" block before the key, so only the key's own block is read.
 */
function privateKeyDer(pem: string): Uint8Array {
  const text = pem.replace(/\\n/g, '\n');
  const block = /-----BEGIN (EC )?PRIVATE KEY-----[\s\S]*?-----END (?:EC )?PRIVATE KEY-----/.exec(text);
  const der = pemToDer(block ? block[0] : text);
  return block?.[1] ? sec1ToPkcs8(der) : der;
}

function toPem(label: string, der: Uint8Array): string {
  let binary = '';
  der.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');
}

/**
 * A new P-256 key pair as PEM: the private key as PKCS#8, the public key as
 * the SubjectPublicKeyInfo that `openssl ec -pubout` writes, which is what
 * Apple Ads asks for.
 */
export async function generateEcKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const [pkcs8, spki] = await Promise.all([crypto.subtle.exportKey('pkcs8', pair.privateKey), crypto.subtle.exportKey('spki', pair.publicKey)]);
  return { privateKeyPem: toPem('PRIVATE KEY', new Uint8Array(pkcs8)), publicKeyPem: toPem('PUBLIC KEY', new Uint8Array(spki)) };
}

async function importKey(
  pem: string,
  algorithm: EcKeyImportParams | RsaHashedImportParams,
  extractable = false
): Promise<CryptoKey> {
  const der = algorithm.name === 'ECDSA' ? privateKeyDer(pem) : pemToDer(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der as BufferSource, algorithm, extractable, ['sign']);
  } catch (error) {
    const plain = algorithm.name === 'ECDSA' ? withoutEcParameters(der) : null;
    if (plain) {
      try {
        return await crypto.subtle.importKey('pkcs8', plain as BufferSource, algorithm, extractable, ['sign']);
      } catch {
        // Not the curve field, then: reported below.
      }
    }
    console.error('Importing the private key failed', error);
    throw new Error(
      'That private key could not be read. It has to be the unmodified key file in PKCS#8 PEM form.'
    );
  }
}

/**
 * The public half of a P-256 private key, as the SubjectPublicKeyInfo PEM
 * Apple Ads asks for. The private key's JWK carries the public point, so
 * nothing has to do curve arithmetic here.
 */
export async function publicKeyOf(privateKeyPem: string): Promise<string> {
  const key = await importKey(privateKeyPem, { name: 'ECDSA', namedCurve: 'P-256' }, true);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const point = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  return toPem('PUBLIC KEY', new Uint8Array(await crypto.subtle.exportKey('spki', point)));
}

async function sign(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
  algorithm: AlgorithmIdentifier | EcdsaParams
): Promise<string> {
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims)
  )}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(signingInput))
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * The App Store Connect bearer token.
 *
 * Apple caps `exp` at 20 minutes out and rejects anything longer, so callers
 * cache these for a few minutes rather than for a session.
 */
export async function createAppStoreConnectJwt(params: {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
  lifetimeSeconds?: number;
  /** Apple's time in milliseconds, when known. This computer's clock otherwise. */
  now?: number;
}): Promise<string> {
  const key = await importKey(params.privateKeyPem, { name: 'ECDSA', namedCurve: 'P-256' });
  const now = Math.floor((params.now ?? Date.now()) / 1000);
  return sign(
    { alg: 'ES256', kid: params.keyId, typ: 'JWT' },
    {
      iss: params.issuerId,
      // Dated a minute back. Apple refuses a token dated more than about two
      // minutes ahead of its own clock, and the clock used here can be off.
      // An older date does no harm (exp is what Apple holds to 20 minutes).
      iat: now - 60,
      exp: now + Math.min(params.lifetimeSeconds ?? 900, 1200),
      aud: 'appstoreconnect-v1',
    },
    key,
    { name: 'ECDSA', hash: 'SHA-256' }
  );
}

/**
 * The client secret Apple Ads trades for an access token at
 * appleid.apple.com. Apple takes up to 180 days; a day is plenty, since a new
 * one is signed for every token.
 */
export async function createAppleAdsClientSecret(params: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  lifetimeSeconds?: number;
  now?: number;
}): Promise<string> {
  const key = await importKey(params.privateKeyPem, { name: 'ECDSA', namedCurve: 'P-256' });
  const now = Math.floor((params.now ?? Date.now()) / 1000);
  return sign(
    { alg: 'ES256', kid: params.keyId },
    {
      sub: params.clientId,
      aud: 'https://appleid.apple.com',
      // A minute back, as for App Store Connect: this computer's clock can run ahead of Apple's.
      iat: now - 60,
      exp: now + Math.min(params.lifetimeSeconds ?? 86_400, 179 * 86_400),
      iss: params.teamId,
    },
    key,
    { name: 'ECDSA', hash: 'SHA-256' }
  );
}

/** The assertion half of Google's JWT bearer grant (RFC 7523). */
export async function createServiceAccountAssertion(params: {
  clientEmail: string;
  privateKeyPem: string;
  privateKeyId?: string;
  scope: string;
  tokenUri: string;
}): Promise<string> {
  const key = await importKey(params.privateKeyPem, {
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256',
  });
  const issuedAt = Math.floor(Date.now() / 1000);
  return sign(
    { alg: 'RS256', typ: 'JWT', ...(params.privateKeyId ? { kid: params.privateKeyId } : {}) },
    {
      iss: params.clientEmail,
      scope: params.scope,
      aud: params.tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    key,
    { name: 'RSASSA-PKCS1-v1_5' }
  );
}
