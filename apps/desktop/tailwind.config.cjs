/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tokens semânticos do design system. As cores existem apenas aqui:
      // componentes usam bg-surface, text-ink-3, border-line etc., nunca hex solto.
      colors: {
        // Preto com fundo verde da marca: o conteúdo compartilhado é o que brilha.
        canvas: '#070A08',
        chrome: '#090D0B',
        surface: '#0D1210',
        raised: '#131A16',
        active: '#1B241F',
        // Verde-floresta do ícone: campos da marca, nunca texto.
        forest: { DEFAULT: '#0B2618', deep: '#06170E' },
        ink: { DEFAULT: '#EEF1EA', 2: '#B5BEB6', 3: '#8E9991', 4: '#7A857D' },
        line: { DEFAULT: '#18211C', strong: '#232D27', input: '#35413A', warm: '#4A3A1F' },
        // Lima da marca: ação principal, seleção e foco. Nada decorativo.
        signal: { DEFAULT: '#C4F04D', hover: '#D4F873', soft: '#DCF59C', ink: '#0A1405' },
        // Âmbar só para avisos (qualidade reduzida, conexão instável).
        warn: { DEFAULT: '#F2B544', soft: '#F6CF85' },
        warm: '#1C170C',
        // Luz vermelha do "no ar": só para quem está transmitindo.
        tally: { DEFAULT: '#FF5144', soft: '#FF8A7F' },
        danger: { DEFAULT: '#F0615D', soft: '#F58581' },
        ok: '#4FD483',
      },
      fontFamily: {
        sans: ['"Geist Variable"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
        // Fonte dos títulos grandes e da marca. Trocar aqui muda o app inteiro.
        display: ['"Geist Variable"', '"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(236,255,230,0.03) inset, 0 12px 32px -12px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(196,240,77,0.22), 0 18px 48px -18px rgba(196,240,77,0.28)',
      },
    },
  },
  plugins: [],
}
