import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { ThemeSync } from '@/components/ThemeSync';
import { THEME_COOKIE, THEME_INIT_SCRIPT, parseThemePreference } from '@/lib/theme';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
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

  const htmlClass = [jetbrainsMono.variable, isLight ? 'light' : null]
    .filter(Boolean)
    .join(' ');

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <body className="font-mono text-fg bg-bg min-h-screen relative">
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
