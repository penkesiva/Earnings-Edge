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
        bg: {
          DEFAULT: '#0a0a0a',
          elevated: '#171717',
          hover: '#1f1f1f',
        },
        border: {
          DEFAULT: '#262626',
          subtle: '#1a1a1a',
        },
        fg: {
          DEFAULT: '#fafafa',
          muted: '#a3a3a3',
          subtle: '#737373',
          dim: '#525252',
        },
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
