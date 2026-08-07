import type {Metadata} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { Analytics } from "@/components/Analytics";
import { I18nProvider } from "@/i18n";

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
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {/* Serialized into the static export so the html lang attribute matches
            the stored/detected UI locale before first paint; the I18nProvider
            keeps it in sync from then on. Mirrors the MobileNotice pattern. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var l=localStorage.getItem('osg-locale');if(l!=='en'&&l!=='es'){l=(navigator.language||'').toLowerCase().indexOf('es')===0?'es':'en'}document.documentElement.lang=l}catch(e){}",
          }}
        />
        <I18nProvider>
          {children}
          <Toaster />
        </I18nProvider>
        <Analytics />
      </body>
    </html>
  );
}
