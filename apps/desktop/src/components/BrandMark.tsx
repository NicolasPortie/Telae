import { useId } from 'react'

/** Símbolo do Telaê sem o fundo do ícone: moldura, tela e ponteiro. Mesmo desenho de public/icon.svg. */
export function BrandMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  const id = useId()
  return (
    <svg aria-hidden="true" data-brand width={size} height={size} viewBox="32 46 132 122" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}f`} x1="36" y1="0" x2="104" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6F2E7" />
          <stop offset=".62" stopColor="#E6E2D6" />
          <stop offset="1" stopColor="#E6E2D6" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="60" y1="0" x2="158" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E9A4E" stopOpacity=".2" />
          <stop offset=".45" stopColor="#5CC64B" />
          <stop offset="1" stopColor="#C9F24C" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="104" y1="98" x2="128" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBFFF6" />
          <stop offset="1" stopColor="#86DE8E" />
        </linearGradient>
      </defs>
      <path d="M44 70V121a8 8 0 0 0 8 8H97" stroke={`url(#${id}f)`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M68 61H142a8 8 0 0 1 8 8V108" stroke={`url(#${id}s)`} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M104 99L155 125L133 138L118 157Z" fill={`url(#${id}p)`} stroke={`url(#${id}p)`} strokeWidth="7" strokeLinejoin="round" />
    </svg>
  )
}

/** Símbolo e nome juntos, como no logo horizontal. */
export function BrandLockup({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`telae-lockup ${className}`} style={{ fontSize: size * 0.82 }}>
      <BrandMark size={size} />
      <span className="telae-wordmark">Tela<span className="text-signal">ê</span></span>
    </span>
  )
}
