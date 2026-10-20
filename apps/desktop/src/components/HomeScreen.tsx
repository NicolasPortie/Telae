import type { ReactNode } from 'react'
import { ArrowRight, Monitor, RefreshCw, Volume2, Zap } from 'lucide-react'
import { t } from '../i18n'
import type { UpdateStatus } from '../shared/contracts'
import { ShareIllustration } from './ShareIllustration'

const UPDATE_BUSY_PHASES = ['checking', 'downloading', 'ready', 'installing']

const steps = () => [
  { title: t('Escolha o que mostrar'), text: t('Uma tela inteira ou só uma janela, com a qualidade que preferir.') },
  { title: t('Seus amigos veem "Ao vivo"'), text: t('Quem está na sua lista é avisado na hora, sem enviar link nem código.') },
  { title: t('Assistem com 1 clique'), text: t('Imagem nítida e som sincronizado, direto entre os computadores.') },
]

const highlights = () => [
  { icon: Monitor, label: t('Até 1440p60') },
  { icon: Volume2, label: t('Áudio do sistema') },
  { icon: Zap, label: t('Baixa latência') },
]

/** Tela inicial: ação principal à esquerda; o painel de amigos (aside) fica sempre visível à direita. */
export function HomeScreen({ displayName, canShare, onChooseScreen, updateStatus, canCheckUpdate, onCheckUpdate, aside }: {
  displayName: string | undefined
  canShare: boolean
  onChooseScreen: () => void
  updateStatus: UpdateStatus | null
  canCheckUpdate: boolean
  onCheckUpdate: () => void
  aside: ReactNode
}) {
  const checking = updateStatus?.phase === 'checking'
  return (
    <section aria-labelledby="home-title" className="telae-panel-enter telae-home">
      <div className="telae-home-grid">
        <div className="telae-home-primary">
          <p className="eyebrow">{t('Olá, {name}', { name: displayName?.split(' ')[0] || t('bem-vindo') })}</p>
          <h1 id="home-title" className="mt-3 text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.045em]">
            {t('Compartilhar a tela ficou simples.')}
          </h1>
          <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-ink-2">
            {t('Mostre sua tela para seus amigos ou assista a quem estiver ao vivo.')}
          </p>

          <div className="telae-home-actions mt-8">
            <section aria-labelledby="share-title" className="telae-share-card">
              <div className="telae-share-body">
                <div className="min-w-0">
                  <h2 id="share-title" className="text-[22px] font-semibold tracking-[-0.03em]">{t('Mostrar minha tela')}</h2>
                  <p className="mt-2 max-w-[38ch] text-sm leading-relaxed text-ink-2">
                    {t('Escolha uma tela ou janela. Seus amigos verão que você está ao vivo e poderão assistir em 1 clique.')}
                  </p>
                  <button type="button" onClick={onChooseScreen} disabled={!canShare} className="telae-press telae-primary-action btn btn-primary btn-lg mt-6">
                    {t('Escolher tela')} <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </div>
                <ShareIllustration />
              </div>
              <ul className="telae-share-highlights" aria-label={t('Recursos')}>
                {highlights().map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2"><Icon size={14} aria-hidden="true" className="text-signal" />{label}</li>
                ))}
              </ul>
            </section>
          </div>

          <ol className="telae-steps" aria-label={t('Como funciona')}>
            {steps().map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true" className="telae-step-number tnum">{index + 1}</span>
                <p className="mt-3 text-[13px] font-medium">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-3">{step.text}</p>
              </li>
            ))}
          </ol>

          <div className="telae-home-footer">
            <p className="text-xs text-ink-3">{updateStatus?.phase === 'current' ? t('Você está na versão mais recente.') : t('As atualizações são instaladas automaticamente pelo app.')}</p>
            <button
              type="button"
              onClick={onCheckUpdate}
              disabled={!canCheckUpdate || UPDATE_BUSY_PHASES.includes(updateStatus?.phase ?? '')}
              className="telae-press telae-check-update"
            >
              <RefreshCw size={14} aria-hidden="true" className={checking ? 'telae-update-spinner' : ''} />
              {checking ? t('Buscando atualização…') : t('Buscar atualização')}
            </button>
          </div>
        </div>
        {aside}
      </div>
    </section>
  )
}
