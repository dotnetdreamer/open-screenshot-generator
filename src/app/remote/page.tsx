import type { Metadata } from 'next';
import { PhoneRemote } from '@/components/open-screenshot-generator/director/PhoneRemote';

// The page Director's QR code opens on a phone. Only the remote's own code
// loads here, never the editor.
export const metadata: Metadata = {
  title: 'Director phone controls',
  robots: { index: false, follow: false },
};

export default function RemotePage() {
  return <PhoneRemote />;
}
