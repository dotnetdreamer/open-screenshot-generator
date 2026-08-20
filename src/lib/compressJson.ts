// Gzip for the two places that store a project document as a file: the cloud
// copy (src/lib/cloud) and the local version history (src/lib/versions).
//
// An artboard document is mostly repeated key names and hex colours, so this is
// routinely an 8x saving. Every browser this app supports has CompressionStream,
// but the feature test is real rather than decorative: the encoding travels with
// the bytes, so a build running somewhere without it stores plain JSON and reads
// back exactly the same.

export type JsonEncoding = 'none' | 'gzip';

export interface PackedJson {
  blob: Blob;
  encoding: JsonEncoding;
}

export async function packJson(json: string): Promise<PackedJson> {
  const plain = new Blob([json], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return { blob: plain, encoding: 'none' };
  try {
    const stream = plain.stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    // A document that got bigger means the stream did nothing useful. Cheap to
    // check, and it keeps the stored file honest.
    if (blob.size >= plain.size) return { blob: plain, encoding: 'none' };
    return { blob, encoding: 'gzip' };
  } catch {
    return { blob: plain, encoding: 'none' };
  }
}

/** The other half. Reads whichever encoding the record says it was stored in. */
export async function unpackJson(blob: Blob, encoding: JsonEncoding): Promise<string> {
  if (encoding !== 'gzip') return blob.text();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
