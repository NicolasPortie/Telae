/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tokens semânticos do design system. As cores existem apenas aqui:
      // componentes usam bg-surface, text-ink-3, border-line etc., nunca hex solto.
      colors: {
        canvas: '#0A0908',
        chrome: '#0D0C0A',
        surface: '#12100E',
        raised: '#1A1713',
        warm: '#1F1910',
        active: '#26211A',
        ink: { DEFAULT: '#F4EFE6', 2: '#BDB6AA', 3: '#948D80', 4: '#867F73' },
        line: { DEFAULT: '#26211B', strong: '#322C24', input: '#463F35', warm: '#4A3A1F' },
        // Luz de projetor: ações principais e destaques.
        signal: { DEFAULT: '#F5B544', hover: '#FFC862', soft: '#F8D08A' },
        // Luz vermelha do "no ar": só para quem está transmitindo.
        tally: { DEFAULT: '#FF5144', soft: '#FF8A7F' },
        danger: { DEFAULT: '#F0615D', soft: '#F58581' },
        ok: '#5FC98A',
      },
      fontFamily: {
        sans: ['"Geist Variable"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
        display: ['"Instrument Serif"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,244,224,0.03) inset, 0 12px 32px -12px rgba(0,0,0,0.65)',
        glow: '0 0 0 1px rgba(245,181,68,0.25), 0 18px 48px -18px rgba(245,181,68,0.35)',
      },
    },
  },
  plugins: [],
}
