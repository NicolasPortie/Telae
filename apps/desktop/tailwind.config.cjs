/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tokens semânticos do design system. As cores existem apenas aqui:
      // componentes usam bg-surface, text-ink-3, border-line etc., nunca hex solto.
      colors: {
        canvas: '#141412',
        surface: '#1C1C19',
        warm: '#24221D',
        active: '#282721',
        ink: { DEFAULT: '#F1EFE8', 2: '#B8B4AA', 3: '#9D9A90', 4: '#6B6860' },
        line: { DEFAULT: '#313029', strong: '#38362E', input: '#4A473E', warm: '#4A4031' },
        signal: { DEFAULT: '#D8A85C', hover: '#E8BB75', soft: '#E8C690' },
        danger: { DEFAULT: '#FF5D5D', soft: '#FF7676' },
        ok: '#7FB996',
      },
    },
  },
  plugins: [],
}
