import { en, type Messages } from './en';

// Spanish catalog lands in a follow-up commit; the English spread keeps every
// key present until then (the Messages type already pins the key set).
export const es: Messages = {
  ...en,
};
