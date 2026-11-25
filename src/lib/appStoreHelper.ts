// The helper the Mac App Store version needs to start Claude Code and Codex
// outside its sandbox (src-tauri/src/outside.rs). Detection reports it in
// `unavailable`; the user saves it from a dialog the app opens.

/** What a detection's `unavailable` says about the helper, or null when it says nothing of it. */
export function helperNeed(unavailable: string | null | undefined): 'missing' | 'outdated' | null {
  if (unavailable === 'helper-missing') return 'missing';
  if (unavailable === 'helper-outdated') return 'outdated';
  return null;
}

/**
 * Open the save dialog on the app's scripts folder and save the helper there.
 * True once it's saved, false when the dialog was cancelled. Rejects with the
 * sentence to show when it was saved somewhere the app can't use.
 */
export async function addAppStoreHelper(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('abs_add_app_store_helper');
}
