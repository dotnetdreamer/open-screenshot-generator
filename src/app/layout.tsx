import type {Metadata} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Analytics } from "@/components/Analytics";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
