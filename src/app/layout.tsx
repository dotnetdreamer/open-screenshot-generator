import type {Metadata, Viewport} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Analytics } from "@/components/Analytics";
import { AdSense } from "@/components/AdSense";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Open Screenshot Generator - Design & Translate App Store Graphics',
  description: 'Canva for App Store & Play Store graphics. Design, localize, and automatically translate app store screenshots and preview videos directly in your browser.',
  keywords: ['app store screenshots', 'play store graphics', 'app screenshot generator', 'localize app screenshots', 'translate app store graphics', 'screenshot maker', 'app store localization'],
};

// Without this the editor loads into a 980px layout viewport on phones and
// every panel renders at a third of its size. `userScalable: false` is here
// because the canvas runs its own pinch-to-zoom (see CanvasArea): browser page
// zoom on top of it would fight the gesture and leave the chrome adrift.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning because the boot script below adds `dark` and a
    // colorScheme style to this element before React sees it, which is a
    // mismatch against the statically exported HTML by definition.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking on purpose, and first: it decides the theme before the body
            is parsed, so a dark-mode load never flashes the light palette. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
        <Analytics />
        <AdSense />
      </body>
    </html>
  );
}
