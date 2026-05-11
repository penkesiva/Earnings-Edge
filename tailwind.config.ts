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
        // Signal colors are intentionally theme-invariant (same green/amber/red on both).
        signal: {
          buy: '#22c55e',
          watch: '#eab308',
          sell: '#ef4444',
          neutral: '#6b7280',
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
