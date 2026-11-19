// The cut-out models, where each one is downloaded from, and which one a
// computer gets.
//
// Both are BiRefNet lite (Zheng and others, "Bilateral Reference for
// High-Resolution Dichotomous Image Segmentation", CAAI AIR 2024; MIT licence,
// see THIRD-PARTY-ASSETS.md), the best of the models we may ship that we
// measured. On 30 DIS5K and 20 PPM-100 pictures in November 2026 the 1024
// pixel model kept 0.92 and 0.99 of the right area, against 0.90 and 0.94 for
// BEN2 and 0.39 and 0.93 for Apple's own subject lifting; the BRIA models score
// higher on BRIA's own tests but their licence forbids commercial use.
//
// The 1024 pixel model needs a GPU: onnxruntime-web runs out of its 4 GB of
// memory with it on the CPU. Measured on an M1 Pro: 2.1 s a picture with
// WebGPU in Chromium, 3.6 s in WKWebView (macOS 26), against 5.9 s for the 512
// pixel model on one CPU thread, where the 1024 one cannot run at all.
//
// The files are fp16 exports other people made of the same weights, pinned to a
// commit and checked against their SHA-256 after download, so a changed file is
// refused rather than run. MIRROR: put a copy somewhere this project controls
// and list it first, so a deleted repository cannot take the feature down.

export type CutoutModelId = 'birefnet-lite-1024' | 'birefnet-lite-512';

export interface CutoutModelSpec {
  id: CutoutModelId;
  /** The square the model reads, in pixels. */
  size: number;
  /** Exact size of the file, which is also how the download's progress is counted. */
  bytes: number;
  sha256: string;
  /** Tried in order until one answers. */
  urls: string[];
  /** Where it runs: 'gpu' needs WebGPU, 'cpu' runs anywhere. */
  device: 'gpu' | 'cpu';
}

export const CUTOUT_MODELS: Record<CutoutModelId, CutoutModelSpec> = {
  // Constant folded and with its wide Concat, Split and Sum nodes rewritten so
  // WebGPU can run it (runes/birefnet-lite-webgpu): it opens in 1.9 s against
  // 5.2 s for an export without that work, and gives the same mask.
  'birefnet-lite-1024': {
    id: 'birefnet-lite-1024',
    size: 1024,
    bytes: 123224205,
    sha256: '348c075771a9f6631d6ac991a1ac613d33910390cf943afa752f3a73c36fca03',
    urls: [
      'https://huggingface.co/runes/birefnet-lite-webgpu/resolve/d553b221039609f1ab170e3c2e651b59f363c98a/birefnet_lite_webgpu_fp16.onnx',
    ],
    device: 'gpu',
  },
  // The same weights exported at 512 (studioludens/birefnet-lite-512), which
  // fits the CPU's memory. Its fp16 file runs on the CPU at fp32's speed (5.9 s
  // against 5.6 s) for half the download.
  'birefnet-lite-512': {
    id: 'birefnet-lite-512',
    size: 512,
    bytes: 98484532,
    sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516',
    urls: [
      'https://huggingface.co/studioludens/birefnet-lite-512/resolve/962e67969ec6acec9c19fab76acee4f5e22e990c/onnx/model_fp16.onnx',
    ],
    device: 'cpu',
  },
};

/**
 * Where else a model may come from, tried first: `{ "<model id>": "<url>" }` in
 * localStorage under this key. For a mirror on a network that cannot reach
 * Hugging Face, and for the e2e suite, which serves the files itself. Safe to
 * point anywhere: a file that does not match the pinned SHA-256 is refused.
 */
export const MODEL_MIRROR_KEY = 'osg.cutout.model-urls';

function mirrored(spec: CutoutModelSpec): CutoutModelSpec {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(MODEL_MIRROR_KEY) : null;
    const url = raw ? (JSON.parse(raw) as Record<string, unknown>)[spec.id] : null;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? { ...spec, urls: [url, ...spec.urls] } : spec;
  } catch {
    return spec;
  }
}

/** The model for a computer with WebGPU, or without it. */
export function modelFor(gpu: boolean): CutoutModelSpec {
  return mirrored(CUTOUT_MODELS[gpu ? 'birefnet-lite-1024' : 'birefnet-lite-512']);
}

/** Megabytes the way a person reads them, rounded. */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
