// Signed JWTs for the two store APIs, using WebCrypto only.
//
// Both stores authenticate a machine, not a person, and both do it with a
// short-lived self-signed JWT:
//
//   App Store Connect  ES256 over a P-256 key, `aud: appstoreconnect-v1`
//   Google Play        RS256 over the service account key, exchanged at
//                      oauth2.googleapis.com for a real access token
//
// Both private keys arrive as PKCS#8 PEM (Apple's .p8 file, and the
// `private_key` field inside a Google service account JSON), so one parser
// covers both. WebCrypto's ECDSA signatures are already raw r||s, which is
// exactly what JWS ES256 wants, so nothing has to unpack DER.

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

async function importKey(
  pem: string,
  algorithm: EcKeyImportParams | RsaHashedImportParams
): Promise<CryptoKey> {
  const der = pemToDer(pem);
  try {
    return await crypto.subtle.importKey('pkcs8', der as BufferSource, algorithm, false, ['sign']);
  } catch {
    throw new Error(
      'That private key could not be read. It has to be the unmodified key file in PKCS#8 PEM form.'
    );
  }
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
}): Promise<string> {
  const key = await importKey(params.privateKeyPem, { name: 'ECDSA', namedCurve: 'P-256' });
  const issuedAt = Math.floor(Date.now() / 1000);
  return sign(
    { alg: 'ES256', kid: params.keyId, typ: 'JWT' },
    {
      iss: params.issuerId,
      iat: issuedAt,
      exp: issuedAt + Math.min(params.lifetimeSeconds ?? 900, 1200),
      aud: 'appstoreconnect-v1',
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
