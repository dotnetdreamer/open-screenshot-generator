// The App Store Connect key in the shape Apple ships it. A .p8 repeats the
// curve inside its ECPrivateKey (the optional [0] parameters field of RFC
// 5915), and WebKit's WebCrypto refuses such a key with a DataError, so jwt.ts
// imports it without that field. Node never writes the field, so the Apple
// shape is built here from a Node key, and WebKit's refusal is played by a
// stub in front of Node's own importKey.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { createAppStoreConnectJwt, withoutEcParameters } from '@/lib/publish/jwt';

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
