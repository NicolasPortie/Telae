// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendsState } from '../hooks/useFriends'
import type { DeviceSnapshot } from '../services/types'
import { FriendsRail } from './FriendsRail'

afterEach(cleanup)

const person = (overrides: Partial<DeviceSnapshot>): DeviceSnapshot => ({
  deviceId: 'device',
  displayName: 'Ana',
  friendCode: 'ana',
  status: 'online',
  isSharing: false,
  activeQualityProfile: null,
  ...overrides,
})

function stateWith(overrides: Partial<FriendsState> = {}): FriendsState {
  return {
    friends: [], requests: [], previews: {}, myUsername: 'nicolas', myHandleCopied: false,
    usernameInput: '', setUsernameInput: vi.fn(),
    addOpen: false, setAddOpen: vi.fn(), closeAddForm: vi.fn(),
    busy: false, error: null, success: null, pendingRemove: null, setPendingRemove: vi.fn(),
    copyMyHandle: vi.fn(), add: vi.fn(), dismissRequest: vi.fn(), remove: vi.fn(),
    hidden: [], setShareHidden: vi.fn(),
    ...overrides,
  }
}

const baseProps = {
  online: true,
  updateStatus: null, canCheckUpdate: true, onCheckUpdate: vi.fn(),
}

describe('FriendsRail', () => {
  it('shows your @ with a copy button and an empty state that asks for a friend\'s @', async () => {
    const state = stateWith()
    render(<FriendsRail state={state} {...baseProps} />)
    expect(screen.getByTestId('my-handle')).toHaveTextContent('@nicolas')
    await userEvent.click(screen.getByRole('button', { name: 'Copiar seu @' }))
    expect(state.copyMyHandle).toHaveBeenCalledOnce()
    expect(screen.getByText('Sua lista está vazia.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar primeiro amigo' }))
    expect(state.setAddOpen).toHaveBeenCalledWith(true)
  })

  it('has no friend code anywhere in the interface', () => {
    render(<FriendsRail state={stateWith({ addOpen: true, friends: [person({})] })} {...baseProps} />)
    expect(screen.queryByText(/código/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('@ do amigo')).toBeInTheDocument()
  })

  it('adds a friend by typing the @ and submitting', async () => {
    const state = stateWith({ addOpen: true, usernameInput: 'bia' })
    render(<FriendsRail state={state} {...baseProps} />)
    const form = screen.getByLabelText('@ do amigo').closest('form')!
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar' }))
    expect(state.add).toHaveBeenCalledOnce()
  })

  it('keeps the add button disabled until the @ has at least 3 characters', () => {
    render(<FriendsRail state={stateWith({ addOpen: true, usernameInput: 'bi' })} {...baseProps} />)
    const form = screen.getByLabelText('@ do amigo').closest('form')!
    expect(within(form).getByRole('button', { name: 'Adicionar' })).toBeDisabled()
  })

  it('shows a loading skeleton, not the empty state, while the server is unreachable', () => {
    render(<FriendsRail state={stateWith()} {...baseProps} online={false} />)
    expect(screen.getByRole('status', { name: 'Conectando ao servidor' })).toBeInTheDocument()
    expect(screen.queryByText('Sua lista está vazia.')).not.toBeInTheDocument()
  })

  it('keeps live friends in the list, on top, so the count always matches the rows', async () => {
    const live = person({ deviceId: 'live', displayName: 'Bia', friendCode: 'bia', status: 'transmitting', isSharing: true, activeQualityProfile: '1080p30' })
    const idle = person({ deviceId: 'idle', displayName: 'Caio', friendCode: 'caio' })
    const away = person({ deviceId: 'away', displayName: 'Dani', friendCode: 'dani', status: 'offline' })
    const onWatch = vi.fn()
    render(<FriendsRail state={stateWith({ friends: [idle, live, away] })} {...baseProps} canWatch onWatch={onWatch} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Ao vivo1', 'Online1', 'Offline1'])
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(screen.getByText('Amigos').nextElementSibling).toHaveTextContent('3')
    expect(within(rows[0]).getByText('Bia')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/Ao vivo/)).toHaveTextContent('1080p')
    expect(within(rows[1]).getByText('@caio')).toBeInTheDocument()
    expect(within(rows[2]).getByText('@dani')).toBeInTheDocument()

    // Só o amigo ao vivo tem "Assistir"; um clique entra na transmissão.
    expect(screen.getAllByRole('button', { name: /^Assistir/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Assistir Bia' }))
    expect(onWatch).toHaveBeenCalledWith(live)
  })

  it('does not let you watch while something else is going on', () => {
    const live = person({ deviceId: 'live', displayName: 'Bia', friendCode: 'bia', status: 'transmitting', isSharing: true })
    render(<FriendsRail state={stateWith({ friends: [live] })} {...baseProps} canWatch={false} />)
    expect(screen.getByRole('button', { name: 'Assistir Bia' })).toBeDisabled()
  })

  it('asks for confirmation before removing a friend', async () => {
    const state = stateWith({ friends: [person({})], pendingRemove: 'ana' })
    render(<FriendsRail state={state} {...baseProps} />)
    const group = screen.getByRole('group', { name: 'Confirmar remoção de Ana' })
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }))
    expect(state.remove).toHaveBeenCalledWith('ana')
  })

  it('lets the user accept (add back) or ignore a friend request', async () => {
    const request = person({ deviceId: 'r', displayName: 'Dani', friendCode: 'dani' })
    const state = stateWith({ requests: [request] })
    render(<FriendsRail state={state} {...baseProps} />)
    expect(screen.getByRole('heading', { name: /Pedidos de amizade/ })).toHaveTextContent('1')
    expect(screen.getByText('@dani')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    expect(state.add).toHaveBeenCalledWith('dani')
    await userEvent.click(screen.getByRole('button', { name: 'Ignorar Dani' }))
    expect(state.dismissRequest).toHaveBeenCalledWith('dani')
  })

  it('hides and shows my streams for a friend without removing them', async () => {
    const bia = person({ deviceId: 'id-bia', displayName: 'Bia', friendCode: 'bia' })
    const caio = person({ deviceId: 'id-caio', displayName: 'Caio', friendCode: 'caio' })
    const state = stateWith({ friends: [bia, caio], hidden: [caio] })
    render(<FriendsRail state={state} {...baseProps} />)

    const [biaRow, caioRow] = screen.getAllByRole('listitem')
    expect(within(biaRow).queryByText('oculto')).not.toBeInTheDocument()
    expect(within(caioRow).getByText('oculto')).toBeInTheDocument()
    await userEvent.click(within(biaRow).getByRole('button', { name: 'Ocultar minhas transmissões de Bia' }))
    expect(state.setShareHidden).toHaveBeenLastCalledWith('bia', true)
    await userEvent.click(within(caioRow).getByRole('button', { name: 'Mostrar minhas transmissões pra Caio' }))
    expect(state.setShareHidden).toHaveBeenLastCalledWith('caio', false)
    expect(state.remove).not.toHaveBeenCalled()
  })

  it('keeps accepting disabled while offline', () => {
    const request = person({ deviceId: 'r', displayName: 'Dani', friendCode: 'dani' })
    render(<FriendsRail state={stateWith({ requests: [request] })} {...baseProps} online={false} />)
    expect(screen.getByRole('button', { name: 'Aceitar' })).toBeDisabled()
  })

  it('adds a friend from one field: Enter sends, Esc closes, and shows a short friend request hint', async () => {
    const state = stateWith({ addOpen: true, usernameInput: 'bia' })
    render(<FriendsRail state={state} {...baseProps} />)
    const form = screen.getByRole('form', { name: 'Adicionar amigo' })
    expect(within(form).getByText(/Envie um pedido de amizade para assistir com um amigo./)).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('@ do amigo'), '{Enter}')
    expect(state.add).toHaveBeenCalledOnce()
    await userEvent.keyboard('{Escape}')
    expect(state.closeAddForm).toHaveBeenCalledOnce()
  })

  it('shows the add result in place of the help text', () => {
    render(<FriendsRail state={stateWith({ addOpen: true, error: 'Esse @ não parece certo.' })} {...baseProps} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Esse @ não parece certo.')
    expect(screen.queryByText(/Envie um pedido de amizade para assistir com um amigo./)).not.toBeInTheDocument()
  })

  it('checks for updates from the rail footer', async () => {
    const onCheckUpdate = vi.fn()
    render(<FriendsRail state={stateWith()} {...baseProps} onCheckUpdate={onCheckUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Buscar atualização' }))
    expect(onCheckUpdate).toHaveBeenCalledOnce()
  })
})
