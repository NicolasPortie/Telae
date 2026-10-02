import { describe, expect, it, vi } from 'vitest'
import { StreamController } from './stream-controller'

function fakeStream() {
  return {
    getTracks: () => [],
  } as unknown as MediaStream
}

describe('StreamController', () => {
  it('starts only with an explicit source and reaches live', async () => {
    const capture = vi.fn(async () => fakeStream())
    const release = vi.fn()
    const controller = new StreamController({ capture, release })

    await expect(controller.start('', 'auto')).rejects.toThrow()
    expect(capture).not.toHaveBeenCalled()

    const stream = await controller.start('screen:1', '1080p60')
    expect(stream).toBeDefined()
    expect(capture).toHaveBeenCalledWith('screen:1', '1080p60', expect.any(AbortSignal))
    expect(controller.getSnapshot().state).toBe('live')
  })

  it('stop releases every track and reaches ended', async () => {
    const stream = fakeStream()
    const capture = vi.fn(async () => stream)
    const release = vi.fn()
    const controller = new StreamController({ capture, release })

    await controller.start('screen:1', 'auto')
    controller.stop()

    expect(release).toHaveBeenCalledWith(stream)
    expect(controller.getSnapshot()).toMatchObject({ state: 'ended', hasStream: false })
  })

  it('a new start tears down the previous stream', async () => {
    const first = fakeStream()
    const second = fakeStream()
    const capture = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const release = vi.fn()
    const controller = new StreamController({ capture, release })

    await controller.start('screen:1', 'auto')
    await controller.start('screen:2', 'auto')

    expect(release).toHaveBeenCalledWith(first)
    expect(controller.getMediaStream()).toBe(second)
  })

  it('capture failure returns to idle with a specific error', async () => {
    const capture = vi.fn(async () => {
      throw new Error('Fonte sem vídeo.')
    })
    const controller = new StreamController({ capture, release: vi.fn() })

    await expect(controller.start('screen:1', 'auto')).rejects.toThrow('Fonte sem vídeo.')
    expect(controller.getSnapshot()).toMatchObject({ state: 'idle', hasStream: false })
    expect(controller.getSnapshot().error).toContain('Fonte sem vídeo.')
  })

  it('notifies subscribers on every transition', async () => {
    const controller = new StreamController({ capture: async () => fakeStream(), release: vi.fn() })
    const states: string[] = []
    controller.subscribe(() => states.push(controller.getSnapshot().state))

    await controller.start('screen:1', 'auto')
    controller.stop()

    expect(states).toEqual(['preparing', 'live', 'ended'])
  })
})


it('prepares a source without disposing the active stream and releases it only on commit', async () => {
  const previous = fakeStream()
  const next = fakeStream()
  const release = vi.fn()
  const controller = new StreamController({ capture: vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(next), release })
  await controller.start('screen:1', 'auto')
  const prepared = await controller.prepareSwitch('screen:2', 'auto')
  expect(controller.getMediaStream()).toBe(previous)
  expect(release).not.toHaveBeenCalled()
  prepared.commit()
  prepared.rollback()
  expect(controller.getMediaStream()).toBe(next)
  expect(release).toHaveBeenCalledExactlyOnceWith(previous)
})

it('stopping while a source is prepared releases both captures and makes commit invalid', async () => {
  const previous = fakeStream()
  const next = fakeStream()
  const release = vi.fn()
  const controller = new StreamController({ capture: vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(next), release })
  await controller.start('screen:1', 'auto')
  const prepared = await controller.prepareSwitch('screen:2', 'auto')
  controller.stop()
  expect(() => prepared.commit()).toThrow()
  prepared.rollback()
  expect(release).toHaveBeenCalledTimes(2)
  expect(controller.getMediaStream()).toBeNull()
})
