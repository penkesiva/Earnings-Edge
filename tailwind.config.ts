import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'var(--font-jetbrains-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
        display: ['Söhne', 'Inter Display', 'sans-serif'],
      },
      colors: {
        // Theme-aware tokens — values come from CSS vars set in globals.css.
        // Light/dark switching happens automatically via prefers-color-scheme.
        bg: {
          DEFAULT: 'var(--color-bg)',
          elevated: 'var(--color-bg-elevated)',
          hover: 'var(--color-bg-hover)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)',
        },
        fg: {
          DEFAULT: 'var(--color-fg)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
          dim: 'var(--color-fg-dim)',
        },
        // Theme-aware via --color-signal-* RGB channels in globals.css
        signal: {
          buy: 'rgb(var(--color-signal-buy) / <alpha-value>)',
          watch: 'rgb(var(--color-signal-watch) / <alpha-value>)',
          sell: 'rgb(var(--color-signal-sell) / <alpha-value>)',
          neutral: 'rgb(var(--color-signal-neutral) / <alpha-value>)',
        },
      },
      letterSpacing: {
        widest: '0.15em',
      },
    },
  },
  plugins: [],
};

export default config;
