// The App Store Connect key in the shape Apple ships it. A .p8 repeats the
// curve inside its ECPrivateKey (the optional [0] parameters field of RFC
// 5915), and WebKit's WebCrypto refuses such a key with a DataError, so jwt.ts
// imports it without that field. Node never writes the field, so the Apple
// shape is built here from a Node key, and WebKit's refusal is played by a
// stub in front of Node's own importKey.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { createAppStoreConnectJwt, createAppleAdsClientSecret, generateEcKeyPair, publicKeyOf, sec1ToPkcs8, withoutEcParameters } from '@/lib/publish/jwt';

/** [0] { prime256v1 }, as it sits in every .p8 from App Store Connect. */
const CURVE_FIELD = Buffer.from([0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

function element(der: Buffer, at: number): { start: number; end: number } {
  let length = der[at + 1];
  let header = 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let index = 0; index < bytes; index += 1) length = length * 256 + der[at + 2 + index];
    header += bytes;
  }
  return { start: at + header, end: at + header + length };
}

function encode(tag: number, body: Buffer): Buffer {
  const header = body.length < 0x80 ? [tag, body.length] : [tag, 0x81, body.length];
  return Buffer.concat([Buffer.from(header), body]);
}

function children(der: Buffer, start: number, end: number): Buffer[] {
  const out: Buffer[] = [];
  for (let at = start; at < end; ) {
    const next = element(der, at).end;
    out.push(der.subarray(at, next));
    at = next;
  }
  return out;
}

/** A Node PKCS#8 EC key with the curve written into its ECPrivateKey, after the private key, as Apple does. */
function appleShaped(der: Buffer): Buffer {
  const outer = element(der, 0);
  const [version, algorithm, octets] = children(der, outer.start, outer.end);
  const wrapped = element(octets, 0);
  const ecKey = element(octets, wrapped.start);
  const [ecVersion, privateKey, publicKey] = children(octets, ecKey.start, ecKey.end);
  const inner = encode(0x04, encode(0x30, Buffer.concat([ecVersion, privateKey, CURVE_FIELD, publicKey])));
  return encode(0x30, Buffer.concat([version, algorithm, inner]));
}

function pem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const nodeDer = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
const appleDer = appleShaped(nodeDer);

test('the key built here has the shape of a real .p8', () => {
  // Measured on a key downloaded from App Store Connect: 150 bytes of DER,
  // ECPrivateKey fields INTEGER, OCTET STRING, [0], [1].
  assert.equal(appleDer.length, 150);
  assert.equal(appleDer.subarray(0, 3).toString('hex'), '308193');
});

test('the curve inside the ECPrivateKey is left out, and nothing else changes', () => {
  assert.deepEqual(Buffer.from(withoutEcParameters(new Uint8Array(appleDer))!), nodeDer);
  // A key without the field, or something that is not a key, is left alone.
  assert.equal(withoutEcParameters(new Uint8Array(nodeDer)), null);
  assert.equal(withoutEcParameters(new Uint8Array([0x30, 0x05, 0x02])), null);
});

test('an App Store Connect token is signed with the key as Apple ships it, where WebKit refuses that shape', async () => {
  const subtle = globalThis.crypto.subtle;
  const original = subtle.importKey.bind(subtle);
  const refused: number[] = [];
  // WebKit: a DataError for any EC PKCS#8 key that carries the curve field.
  subtle.importKey = (async (format: KeyFormat, data: BufferSource, ...rest: unknown[]) => {
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from((data as Uint8Array).buffer, (data as Uint8Array).byteOffset, data.byteLength);
    if (format === 'pkcs8' && bytes.includes(CURVE_FIELD)) {
      refused.push(bytes.length);
      throw new DOMException('Data provided to an operation does not meet requirements', 'DataError');
    }
    return (original as (...args: unknown[]) => Promise<CryptoKey>)(format, data, ...rest);
  }) as typeof subtle.importKey;
  try {
    const token = await createAppStoreConnectJwt({ issuerId: 'issuer', keyId: 'KEY1234567', privateKeyPem: pem(appleDer), now: 1_800_000_000_000 });
    assert.deepEqual(refused, [150], 'the key was first tried as it came');
    const [header, claims, signature] = token.split('.');
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(pair.privateKey), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    );
    assert.ok(valid, 'the signature checks out against the key pair');
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), {
      iss: 'issuer',
      iat: 1_800_000_000 - 60,
      exp: 1_800_000_000 + 900,
      aud: 'appstoreconnect-v1',
    });
  } finally {
    subtle.importKey = original;
  }
});

// --- Apple Ads -----------------------------------------------------------------------------

/** WebKit's refusal, played in front of Node's importKey: a DataError for any EC PKCS#8 key that carries the curve field. */
function refuseCurveField(): { refused: number[]; restore: () => void } {
  const subtle = globalThis.crypto.subtle;
  const original = subtle.importKey.bind(subtle);
  const refused: number[] = [];
  subtle.importKey = (async (format: KeyFormat, data: BufferSource | JsonWebKey, ...rest: unknown[]) => {
    if (format === 'pkcs8') {
      const view = data as Uint8Array;
      const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(view.buffer, view.byteOffset, view.byteLength);
      if (bytes.includes(CURVE_FIELD)) {
        refused.push(bytes.length);
        throw new DOMException('Data provided to an operation does not meet requirements', 'DataError');
      }
    }
    return (original as (...args: unknown[]) => Promise<CryptoKey>)(format, data, ...rest);
  }) as typeof subtle.importKey;
  return { refused, restore: () => (subtle.importKey = original) };
}

function claimsOf(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signed: Buffer; signature: Buffer } {
  const [header, claims, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
    signed: Buffer.from(`${header}.${claims}`),
    signature: Buffer.from(signature, 'base64url'),
  };
}

test('an Apple Ads client secret is signed with a key the app made, and its public key is the one to give Apple Ads', async () => {
  const made = await generateEcKeyPair();
  assert.match(made.privateKeyPem, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.match(made.publicKeyPem, /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n$/);
  const secret = await createAppleAdsClientSecret({ clientId: 'SEARCHADS.c', teamId: 'SEARCHADS.t', keyId: 'k-1', privateKeyPem: made.privateKeyPem, now: 1_800_000_000_000 });
  const { header, claims, signed, signature } = claimsOf(secret);
  assert.deepEqual(header, { alg: 'ES256', kid: 'k-1' });
  assert.deepEqual(claims, { sub: 'SEARCHADS.c', aud: 'https://appleid.apple.com', iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 86_400, iss: 'SEARCHADS.t' });
  assert.ok(verify('sha256', signed, { key: createPublicKey(made.publicKeyPem), dsaEncoding: 'ieee-p1363' }, signature), 'Apple can check the secret with the public key');
  // The public key read back out of the private one is the same.
  assert.equal(await publicKeyOf(made.privateKeyPem), made.publicKeyPem);
  // Apple takes 180 days at most.
  const long = claimsOf(await createAppleAdsClientSecret({ clientId: 'c', teamId: 't', keyId: 'k', privateKeyPem: made.privateKeyPem, now: 0, lifetimeSeconds: 400 * 86_400 }));
  assert.ok((long.claims.exp as number) - (long.claims.iat as number) < 180 * 86_400);
});

test("a key made with OpenSSL, as Apple's guide shows, is wrapped as PKCS#8 and signs, where WebKit refuses the curve field", async () => {
  const openssl = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sec1 = openssl.privateKey.export({ type: 'sec1', format: 'der' });
  // OpenSSL's "EC PRIVATE KEY" names the curve inside, as Apple's .p8 files do.
  assert.ok(sec1.includes(CURVE_FIELD));
  const wrapped = sec1ToPkcs8(new Uint8Array(sec1));
  assert.deepEqual(Buffer.from(withoutEcParameters(wrapped)!), openssl.privateKey.export({ type: 'pkcs8', format: 'der' }));

  const pem = openssl.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  assert.match(pem, /^-----BEGIN EC PRIVATE KEY-----/);
  const webkit = refuseCurveField();
  try {
    const secret = await createAppleAdsClientSecret({ clientId: 'c', teamId: 't', keyId: 'k', privateKeyPem: pem, now: 1_800_000_000_000 });
    assert.deepEqual(webkit.refused, [wrapped.length], 'the wrapped key was first tried as it came');
    const { signed, signature } = claimsOf(secret);
    assert.ok(verify('sha256', signed, { key: createPublicKey(openssl.privateKey), dsaEncoding: 'ieee-p1363' }, signature));
    assert.equal(await publicKeyOf(pem), createPublicKey(openssl.privateKey).export({ type: 'spki', format: 'pem' }).toString());
  } finally {
    webkit.restore();
  }
});

test('a pasted text that is not a key says so', async () => {
  await assert.rejects(() => publicKeyOf('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'), /could not be read/);
  await assert.rejects(() => createAppleAdsClientSecret({ clientId: 'c', teamId: 't', keyId: 'k', privateKeyPem: 'hello' }), /not valid PEM|could not be read/);
});

test('an OpenSSL key file that starts with its EC PARAMETERS block is read by its key block alone', async () => {
  const openssl = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  // What `openssl ecparam -genkey -name prime256v1` writes without -noout.
  const parameters = '-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----\n';
  const pem = parameters + openssl.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
  const secret = await createAppleAdsClientSecret({ clientId: 'c', teamId: 't', keyId: 'k', privateKeyPem: pem, now: 1_800_000_000_000 });
  const { signed, signature } = claimsOf(secret);
  assert.ok(verify('sha256', signed, { key: createPublicKey(openssl.privateKey), dsaEncoding: 'ieee-p1363' }, signature));
  assert.equal(await publicKeyOf(pem), createPublicKey(openssl.privateKey).export({ type: 'spki', format: 'pem' }).toString());
});
