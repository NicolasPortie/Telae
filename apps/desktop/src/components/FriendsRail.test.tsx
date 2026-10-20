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
  friendCode: 'ABC234',
  status: 'online',
  isSharing: false,
  activeQualityProfile: null,
  ...overrides,
})

function stateWith(overrides: Partial<FriendsState> = {}): FriendsState {
  return {
    friends: [], requests: [], myFriendCode: 'XYZ789', myCodeCopied: false,
    codeInput: '', setCodeInput: vi.fn(),
    addOpen: false, setAddOpen: vi.fn(), closeAddForm: vi.fn(),
    busy: false, error: null, success: null, pendingRemoveCode: null, setPendingRemoveCode: vi.fn(),
    copyMyCode: vi.fn(), add: vi.fn(), dismissRequest: vi.fn(), remove: vi.fn(),
    ...overrides,
  }
}

const baseProps = {
  online: true, canWatch: true, watchingDeviceId: null, watchError: null, onWatch: vi.fn(),
  updateStatus: null, canCheckUpdate: true, onCheckUpdate: vi.fn(),
}

describe('FriendsRail', () => {
  it('shows the personal code and an empty state with a call to action', async () => {
    const state = stateWith()
    render(<FriendsRail state={state} {...baseProps} />)
    expect(screen.getByTestId('my-friend-code')).toHaveTextContent('XYZ789')
    expect(screen.getByText('Sua lista está vazia.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar primeiro amigo' }))
    expect(state.setAddOpen).toHaveBeenCalledWith(true)
  })

  it('shows a loading skeleton, not the empty state, while the server is unreachable', () => {
    render(<FriendsRail state={stateWith()} {...baseProps} online={false} />)
    expect(screen.getByRole('status', { name: 'Conectando ao servidor' })).toBeInTheDocument()
    expect(screen.queryByText('Sua lista está vazia.')).not.toBeInTheDocument()
  })

  it('groups friends into live, online and offline, and offers "Assistir" only to live ones', async () => {
    const onWatch = vi.fn()
    const live = person({ deviceId: 'live', displayName: 'Bia', friendCode: 'BBB222', status: 'transmitting', isSharing: true, activeQualityProfile: '1080p60' })
    const idle = person({ deviceId: 'idle', displayName: 'Caio', friendCode: 'CCC333' })
    const away = person({ deviceId: 'away', displayName: 'Dani', friendCode: 'DDD444', status: 'offline' })
    render(<FriendsRail state={stateWith({ friends: [live, idle, away] })} {...baseProps} onWatch={onWatch} />)

    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Ao vivo1', 'Online1', 'Offline1'])
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('Bia')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Assistir' })).not.toBeInTheDocument()
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Assistir' }))
    expect(onWatch).toHaveBeenCalledWith(live)
  })

  it('asks for confirmation before removing a friend', async () => {
    const state = stateWith({ friends: [person({})], pendingRemoveCode: 'ABC234' })
    render(<FriendsRail state={state} {...baseProps} />)
    const group = screen.getByRole('group', { name: 'Confirmar remoção de Ana' })
    await userEvent.click(within(group).getByRole('button', { name: 'Remover' }))
    expect(state.remove).toHaveBeenCalledWith('ABC234')
  })

  it('lets the user accept or dismiss a friend request', async () => {
    const request = person({ deviceId: 'r', displayName: 'Dani', friendCode: 'DDD444' })
    const state = stateWith({ requests: [request] })
    render(<FriendsRail state={state} {...baseProps} />)
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar de volta' }))
    expect(state.add).toHaveBeenCalledWith('DDD444')
    await userEvent.click(screen.getByRole('button', { name: 'Ignorar' }))
    expect(state.dismissRequest).toHaveBeenCalledWith('DDD444')
  })

  it('checks for updates from the rail footer', async () => {
    const onCheckUpdate = vi.fn()
    render(<FriendsRail state={stateWith()} {...baseProps} onCheckUpdate={onCheckUpdate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Buscar atualização' }))
    expect(onCheckUpdate).toHaveBeenCalledOnce()
  })
})
