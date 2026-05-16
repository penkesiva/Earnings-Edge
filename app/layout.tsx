import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { THEME_COOKIE, THEME_INIT_SCRIPT } from '@/lib/theme';
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
  const themeCookie = cookies().get(THEME_COOKIE)?.value;
  const isLight = themeCookie === 'light';

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
        {children}
      </body>
    </html>
  );
}
