import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolveAudioBridgePath(
  options: { packaged: boolean; resourcesPath: string; appPath: string },
  exists: (file: string) => boolean = existsSync,
): string {
  const executable = 'Telae.AudioBridge.exe'
  const candidates = options.packaged
    ? [path.join(options.resourcesPath, 'audio-bridge', executable)]
    : [
        path.join(options.appPath, 'build', 'audio-bridge', executable),
        ...['Release', 'Debug'].flatMap(configuration => [
          path.resolve(options.appPath, '..', 'audio-bridge', 'bin', configuration, 'net10.0-windows10.0.19041.0', 'win-x64', executable),
          path.resolve(options.appPath, '..', 'audio-bridge', 'bin', configuration, 'net10.0-windows10.0.19041.0', executable),
        ]),
      ]
  const found = candidates.find(exists)
  if (!found) throw new Error('Audio bridge não encontrado. Execute npm run build:audio-bridge antes de iniciar o desktop.')
  return found
}
