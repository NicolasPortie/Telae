/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tokens semânticos do design system. As cores existem apenas aqui:
      // componentes usam bg-surface, text-ink-3, border-line etc., nunca hex solto.
      colors: {
        canvas: '#0B0B0D',
        chrome: '#0E0E11',
        surface: '#131316',
        raised: '#19191D',
        warm: '#1A1712',
        active: '#222227',
        ink: { DEFAULT: '#F4F3EF', 2: '#B6B5AF', 3: '#8E8D88', 4: '#82817B' },
        line: { DEFAULT: '#222226', strong: '#2D2D33', input: '#3B3B43', warm: '#3D3220' },
        signal: { DEFAULT: '#E0AE5E', hover: '#EBC079', soft: '#EFCE9B' },
        danger: { DEFAULT: '#F0615D', soft: '#F58581' },
        ok: '#5FC98A',
      },
      fontFamily: {
        sans: ['"Geist Variable"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 32px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(224,174,94,0.25), 0 18px 48px -18px rgba(224,174,94,0.35)',
      },
    },
  },
  plugins: [],
}
