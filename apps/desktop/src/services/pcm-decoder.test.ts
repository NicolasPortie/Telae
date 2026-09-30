import { expect, it } from 'vitest'
import { PcmDecoder } from './pcm-decoder'

it('preserves samples and stereo frames across every possible pipe split', () => {
  const original = new Float32Array([0.25, -0.5, 0.75, -1, 0, 0.1])
  const bytes = new Uint8Array(original.buffer)
  for (let split = 1; split < bytes.length; split++) {
    const decoder = new PcmDecoder(2)
    const first = decoder.push(bytes.slice(0, split))
    const second = decoder.push(bytes.slice(split))
    expect(first.length % 2).toBe(0)
    expect([...first, ...second]).toEqual([...original])
  }
})

it('accumulates single bytes until a complete frame is available', () => {
  const original = new Float32Array([0.5, -0.5])
  const decoder = new PcmDecoder(2)
  const result = [...new Uint8Array(original.buffer)].flatMap(byte => [...decoder.push(new Uint8Array([byte]))])
  expect(result).toEqual([...original])
})
