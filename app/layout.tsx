import type { Metadata } from 'next';
import { JetBrains_Mono, Source_Sans_3, Source_Serif_4 } from 'next/font/google';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { ThemeSync } from '@/components/ThemeSync';
import { THEME_COOKIE, THEME_INIT_SCRIPT, parseThemePreference } from '@/lib/theme';
import './globals.css';

/** Yahoo-like UI sans (Yahoo Sans is proprietary; Source Sans 3 is the closest open match). */
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

/** Yahoo-like headline serif (Yahoo Serif is proprietary). */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-serif',
  display: 'swap',
});

/** Data, strikes, trade legs — keep monospace where numbers align. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Earnings Edge',
  description: 'Pre-earnings decision engine',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const preference = parseThemePreference(cookies().get(THEME_COOKIE)?.value);
  // auto: only the browser knows local PST/EST/etc. — client script sets class before paint
  const isLight = preference === 'light';

  const htmlClass = [sourceSans.variable, sourceSerif.variable, jetbrainsMono.variable, isLight ? 'light' : null]
    .filter(Boolean)
    .join(' ');

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <body className="font-sans text-fg bg-bg min-h-screen relative antialiased">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
