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
    friends: [], requests: [], myUsername: 'nicolas', myHandleCopied: false,
    usernameInput: '', setUsernameInput: vi.fn(),
    addOpen: false, setAddOpen: vi.fn(), closeAddForm: vi.fn(),
    busy: false, error: null, success: null, pendingRemove: null, setPendingRemove: vi.fn(),
    copyMyHandle: vi.fn(), add: vi.fn(), dismissRequest: vi.fn(), remove: vi.fn(),
    ...overrides,
  }
}

const baseProps = {
  online: true, canWatch: true, watchingDeviceId: null, watchError: null, onWatch: vi.fn(),
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

  it('groups friends into live, online and offline, shows each @, and offers "Assistir" only to live ones', async () => {
    const onWatch = vi.fn()
    const live = person({ deviceId: 'live', displayName: 'Bia', friendCode: 'bia', status: 'transmitting', isSharing: true })
    const idle = person({ deviceId: 'idle', displayName: 'Caio', friendCode: 'caio' })
    const away = person({ deviceId: 'away', displayName: 'Dani', friendCode: 'dani', status: 'offline' })
    render(<FriendsRail state={stateWith({ friends: [live, idle, away] })} {...baseProps} onWatch={onWatch} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Ao vivo1', 'Online1', 'Offline1'])
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('@bia')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Assistir' })).not.toBeInTheDocument()
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Assistir' }))
    expect(onWatch).toHaveBeenCalledWith(live)
  })

  it('asks for confirmation before removing a friend', async () => {
    const state = stateWith({ friends: [person({})], pendingRemove: 'ana' })
    render(<FriendsRail state={state} {...baseProps} />)
    const group = screen.getByRole('group', { name: 'Confirmar remoção de Ana' })
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }))
    expect(state.remove).toHaveBeenCalledWith('ana')
  })

  it('lets the user accept or dismiss a friend request', async () => {
    const request = person({ deviceId: 'r', displayName: 'Dani', friendCode: 'dani' })
    const state = stateWith({ requests: [request] })
    render(<FriendsRail state={state} {...baseProps} />)
    expect(screen.getByText('@dani')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar de volta' }))
    expect(state.add).toHaveBeenCalledWith('dani')
    await userEvent.click(screen.getByRole('button', { name: 'Ignorar' }))
    expect(state.dismissRequest).toHaveBeenCalledWith('dani')
  })

  it('checks for updates from the rail footer', async () => {
    const onCheckUpdate = vi.fn()
    render(<FriendsRail state={stateWith()} {...baseProps} onCheckUpdate={onCheckUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Buscar atualização' }))
    expect(onCheckUpdate).toHaveBeenCalledOnce()
  })
})
