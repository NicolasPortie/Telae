import path from 'node:path'
import { expect, it } from 'vitest'
import { resolveAudioBridgePath } from './audio-bridge-path.ts'

const options = { packaged: false, resourcesPath: path.resolve('resources'), appPath: path.resolve('desktop') }

it('finds the published bridge in a clean development or CI checkout', () => {
  const published = path.join(options.appPath, 'build', 'audio-bridge', 'Telae.AudioBridge.exe')
  expect(resolveAudioBridgePath(options, file => file === published)).toBe(published)
})

it('finds a runtime-specific dotnet build when no published bridge exists', () => {
  const compiled = path.resolve(options.appPath, '..', 'audio-bridge', 'bin', 'Release', 'net10.0-windows10.0.19041.0', 'win-x64', 'Telae.AudioBridge.exe')
  expect(resolveAudioBridgePath(options, file => file === compiled)).toBe(compiled)
})

it('uses only bundled resources in the installed app', () => {
  const installed = path.join(options.resourcesPath, 'audio-bridge', 'Telae.AudioBridge.exe')
  expect(resolveAudioBridgePath({ ...options, packaged: true }, file => file === installed)).toBe(installed)
  expect(() => resolveAudioBridgePath({ ...options, packaged: true }, () => false)).toThrow('Audio bridge não encontrado')
})
