import { useId } from 'react'

/**
 * Ninguém no ar: o símbolo em espera. A moldura e a tela respiram, ondas de sinal procuram
 * transmissões e o ponteiro dá um toque de vez em quando, convidando a começar.
 */
export function IdleSignal() {
  const id = useId()
  return (
    <svg aria-hidden="true" className="telae-idle" viewBox="0 0 240 240" fill="none">
      <defs>
        <linearGradient id={`${id}f`} x1="64" y1="0" x2="132" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6F2E7" />
          <stop offset=".62" stopColor="#E6E2D6" />
          <stop offset="1" stopColor="#E6E2D6" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="88" y1="0" x2="186" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E9A4E" stopOpacity=".2" />
          <stop offset=".45" stopColor="#5CC64B" />
          <stop offset="1" stopColor="#C9F24C" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="132" y1="118" x2="156" y2="180" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBFFF6" />
          <stop offset="1" stopColor="#86DE8E" />
        </linearGradient>
      </defs>
      <g className="telae-idle-waves">
        <circle cx="120" cy="120" r="74" />
        <circle cx="120" cy="120" r="74" />
        <circle cx="120" cy="120" r="74" />
      </g>
      {/* Mesmo desenho do ícone, centralizado no quadro. */}
      <g transform="translate(-5 -12)">
        <path className="telae-idle-frame" d="M72 96V147a8 8 0 0 0 8 8H125" stroke={`url(#${id}f)`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
        <path className="telae-idle-screen" d="M96 87H170a8 8 0 0 1 8 8V134" stroke={`url(#${id}s)`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
        <g className="telae-idle-pointer">
          <circle className="telae-idle-tap" cx="132" cy="125" r="6" />
          <path d="M132 125L183 151L161 164L146 183Z" fill={`url(#${id}p)`} stroke={`url(#${id}p)`} strokeWidth="7" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  )
}
