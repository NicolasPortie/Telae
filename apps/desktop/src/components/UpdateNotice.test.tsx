// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice'

afterEach(cleanup)

it('keeps current and generic installations free of startup warnings', () => {
  const props = { sessionActive: false, onRetry: vi.fn() }
  const { rerender, container } = render(<UpdateNotice {...props} status={{ phase: 'unavailable', version: '0.3.1' }} />)
  expect(container).toBeEmptyDOMElement()
  rerender(<UpdateNotice {...props} status={{ phase: 'current', version: '0.3.1' }} />)
  expect(container).toBeEmptyDOMElement()
})

it('offers a manual download for a new version without an error or retry loop', async () => {
  const onRetry = vi.fn()
  render(<UpdateNotice status={{ phase: 'manual', version: '0.3.2' }} sessionActive={false} onRetry={onRetry} />)
  expect(screen.getByRole('status')).toHaveTextContent('A versão 0.3.2 está disponível.')
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Baixar atualização' }))
  expect(onRetry).toHaveBeenCalledOnce()
})
