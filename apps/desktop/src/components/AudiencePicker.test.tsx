// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { audienceSummary, leavingWatchers, watcherCodes, withKnownFriends, withModeChange } from '../services/audience'
import { DEFAULT_AUDIENCE, type DeviceSnapshot, type ShareAudience } from '../services/types'
import { AudienceEditor } from './AudienceEditor'
import { AudiencePicker } from './AudiencePicker'

afterEach(cleanup)

const friend = (code: string, name = code): DeviceSnapshot => ({
  deviceId: `id-${code}`, displayName: name, friendCode: code, status: 'online', isSharing: false, activeQualityProfile: null,
})
const friends = [friend('bia', 'Bia'), friend('caio', 'Caio'), friend('duda', 'Duda')]
const watcher = (code: string, name = code) => ({ deviceId: `id-${code}`, displayName: name })
const selected = (names: string[]): ShareAudience => ({ mode: 'selected', selected: names })

describe('audience rules', () => {
  it('summarizes the choice in one line', () => {
    expect(audienceSummary(DEFAULT_AUDIENCE)).toBe('Todos os amigos')
    expect(audienceSummary(selected(['bia']))).toBe('1 amigo escolhido')
    expect(audienceSummary(selected(['bia', 'caio']))).toBe('2 amigos escolhidos')
  })

  it('finds the @ of who is watching right now', () => {
    expect(watcherCodes([watcher('bia'), watcher('caio')], friends)).toEqual(['bia', 'caio'])
    // Quem não está na lista de amigos não entra na conta.
    expect(watcherCodes([watcher('estranho')], friends)).toEqual([])
  })

  it('names only the watchers who would leave, and only in "chosen" mode', () => {
    const watchers = [watcher('bia', 'Bia'), watcher('caio', 'Caio')]
    expect(leavingWatchers(DEFAULT_AUDIENCE, watchers, friends)).toEqual([])
    expect(leavingWatchers(selected(['bia', 'caio']), watchers, friends)).toEqual([])
    expect(leavingWatchers(selected(['bia']), watchers, friends)).toEqual(['Caio'])
    expect(leavingWatchers(selected([]), watchers, friends)).toEqual(['Bia', 'Caio'])
    // Marcar alguém que não está assistindo não tira ninguém.
    expect(leavingWatchers(selected(['bia', 'caio', 'duda']), watchers, friends)).toEqual([])
  })

  it('starts "chosen" from who is watching when switching from "all"', () => {
    const watchers = [watcher('bia')]
    const next = withModeChange(DEFAULT_AUDIENCE, { ...DEFAULT_AUDIENCE, mode: 'selected' }, watchers, friends)
    expect(next.selected).toEqual(['bia'])
    // Seleções anteriores não deixam quem já assiste desmarcado ao voltar para "escolhidos".
    expect(withModeChange(DEFAULT_AUDIENCE, selected(['caio']), watchers, friends).selected).toEqual(['caio', 'bia'])
    expect(withModeChange(selected(['caio']), selected([]), watchers, friends).selected).toEqual([])
    // Voltar para "todos" não muda nada.
    expect(withModeChange(selected(['bia']), { ...DEFAULT_AUDIENCE }, watchers, friends)).toEqual(DEFAULT_AUDIENCE)
  })

  it('drops chosen people who are no longer friends', () => {
    expect(withKnownFriends(selected(['bia', 'ex_amiga']), friends).selected).toEqual(['bia'])
    // Sem a lista carregada, mantém a escolha: o servidor também filtra.
    expect(withKnownFriends(selected(['bia', 'ex_amiga']), []).selected).toEqual(['bia', 'ex_amiga'])
  })
})

/** O picker é controlado: o teste guarda o valor como o App faz. */
function Controlled({ initial = DEFAULT_AUDIENCE, onChange }: { initial?: ShareAudience; onChange?: (value: ShareAudience) => void }) {
  const [value, setValue] = useState(initial)
  return <AudiencePicker value={value} friends={friends} onChange={next => { setValue(next); onChange?.(next) }} />
}

describe('AudiencePicker', () => {
  it('offers only two audience choices, with no preview toggle or approval flow', async () => {
    render(<Controlled />)
    await userEvent.click(screen.getByRole('button', { name: /Quem pode ver/ }))
    expect(screen.getAllByRole('radio').map(radio => radio.textContent)).toEqual([
      expect.stringContaining('Todos os amigos'), expect.stringContaining('Amigos escolhidos'),
    ])
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByText(/prévia no início/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/pedir pra entrar|aprov/i)).not.toBeInTheDocument()
  })

  it('picks friends, marks all and clears the audience', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    const toggle = screen.getByRole('button', { name: /Quem pode ver/ })
    await userEvent.click(toggle)

    await userEvent.click(screen.getByRole('radio', { name: /Amigos escolhidos/ }))
    expect(screen.getByText('0 de 3 podem ver')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByRole('checkbox', { name: /Bia/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('1 de 3 podem ver')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todos' }))
    expect(screen.getByText('3 de 3 podem ver')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar todos' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Caio/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', selected: ['caio'] })
    expect(toggle).toHaveTextContent('1 amigo escolhido')
  })

  it('warns when nobody is picked', async () => {
    render(<Controlled initial={selected([])} />)
    expect(screen.getByRole('status')).toHaveTextContent('Ninguém marcado')
  })

  it('moves between the two modes with the arrow keys', async () => {
    render(<Controlled />)
    await userEvent.click(screen.getByRole('button', { name: /Quem pode ver/ }))
    screen.getByRole('radio', { name: /Todos os amigos/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: /Amigos escolhidos/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Amigos escolhidos/ })).toHaveFocus()
  })
})

describe('AudienceEditor (during the stream)', () => {
  const watchers = [watcher('bia', 'Bia'), watcher('caio', 'Caio')]
  const setup = (onApply = vi.fn<() => Promise<void>>(async () => undefined), audience: ShareAudience = DEFAULT_AUDIENCE) => {
    render(<AudienceEditor audience={audience} friends={friends} watchers={watchers} busy={false} onApply={onApply} />)
    return onApply
  }

  it('starts "chosen" with who is watching already marked and tagged', async () => {
    setup()
    expect(screen.getByText('Todos os amigos')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('radio', { name: /Amigos escolhidos/ }))

    expect(screen.getByRole('checkbox', { name: /Bia/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /Caio/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: /Duda/ })).toHaveAttribute('aria-checked', 'false')
    expect(within(screen.getByRole('checkbox', { name: /Bia/ })).getByText('Assistindo')).toBeInTheDocument()
    expect(within(screen.getByRole('checkbox', { name: /Duda/ })).queryByText('Assistindo')).toBeNull()
    // Nada muda para quem está assistindo até você desmarcar alguém.
    expect(screen.queryByText(/sai da transmissão|saem da transmissão/)).toBeNull()
  })

  it('says by name who leaves, only after unchecking, and applies on confirm', async () => {
    const onApply = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('radio', { name: /Amigos escolhidos/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Caio/ }))
    expect(screen.getByText('Caio sai da transmissão ao aplicar.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('Bia e Caio saem da transmissão ao aplicar.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Duda/ }))
    expect(screen.getByText('Caio sai da transmissão ao aplicar.')).toBeInTheDocument()

    expect(onApply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onApply).toHaveBeenCalledWith({ mode: 'selected', selected: ['bia', 'duda'] })
    expect(screen.getByRole('button', { name: 'Alterar' })).toBeInTheDocument()
  })

  it('keeps the draft open and shows the reason when the server refuses', async () => {
    setup(vi.fn(async () => { throw new Error('Não deu pra mudar quem pode ver. Tenta de novo.') }))
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Não deu pra mudar quem pode ver')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Alterar' })).toBeInTheDocument()
  })

  it('going back to everyone never warns about leaving', async () => {
    setup(undefined, selected(['bia']))
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('radio', { name: /Todos os amigos/ }))
    expect(screen.queryByText(/sai da transmissão|saem da transmissão/)).toBeNull()
  })

  it('marks current watchers again when returning to chosen friends', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('radio', { name: /Amigos escolhidos/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Caio/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Todos os amigos/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Amigos escolhidos/ }))

    expect(screen.getByRole('checkbox', { name: /Caio/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(/sai da transmissão|saem da transmissão/)).toBeNull()
  })

  it('locks the draft while the audience update is pending', async () => {
    let finish!: () => void
    const onApply = setup(vi.fn(() => new Promise<void>(resolve => { finish = resolve })))
    await userEvent.click(screen.getByRole('button', { name: 'Alterar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

    for (const name of ['Aplicar', 'Cancelar']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Amigos escolhidos/ })).toBeDisabled()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.getByRole('button', { name: 'Alterar' })).toBeEnabled()
  })
})
