import { useId } from 'react'
import { t } from '../i18n'

/**
 * Palco da entrada: as duas molduras do símbolo, em escala de tela, se desenham e enquadram a frase
 * como se ela estivesse sendo transmitida; o ponteiro do logo pousa e toca, convidando a entrar.
 */
export function AuthShowcase() {
  const id = useId()
  return (
    <div className="telae-auth-stage" aria-hidden="true">
      <svg className="telae-auth-bracket is-frame" viewBox="0 0 320 250" preserveAspectRatio="xMinYMax meet" fill="none">
        <defs>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F6F2E7" />
            <stop offset=".6" stopColor="#E6E2D6" />
            <stop offset="1" stopColor="#E6E2D6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path pathLength={1} d="M16 0V218a16 16 0 0 0 16 16H320" stroke={`url(#${id}f)`} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg className="telae-auth-bracket is-screen" viewBox="0 0 320 250" preserveAspectRatio="xMaxYMin meet" fill="none">
        <defs>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2E9A4E" stopOpacity="0" />
            <stop offset=".5" stopColor="#5CC64B" />
            <stop offset="1" stopColor="#C9F24C" />
          </linearGradient>
        </defs>
        <path pathLength={1} d="M0 16H288a16 16 0 0 1 16 16V250" stroke={`url(#${id}s)`} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="telae-auth-copy">
        <span className="telae-auth-live"><span className="tally" /> {t('Ao vivo')}</span>
        <p className="telae-auth-statement">{t('Passa a tela pros amigos.')}</p>
        <p className="telae-auth-lede">{t('Imagem nítida e som junto, sem criar sala nem mandar link.')}</p>
      </div>

      <svg className="telae-auth-pointer" viewBox="0 0 80 90" fill="none">
        <defs>
          <linearGradient id={`${id}p`} x1="10" y1="6" x2="38" y2="80" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FBFFF6" />
            <stop offset="1" stopColor="#86DE8E" />
          </linearGradient>
        </defs>
        <circle className="telae-auth-tap" cx="10" cy="8" r="7" />
        <path d="M10 8L66 37L42 51L26 72Z" fill={`url(#${id}p)`} stroke={`url(#${id}p)`} strokeWidth="8" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
