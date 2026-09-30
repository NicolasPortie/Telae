import { contextBridge, ipcRenderer } from 'electron'
import type { AudioBridgeState, LocalProfile, TelaeDesktopApi, UpdateStatus } from '../shared/contracts.ts'

const api: TelaeDesktopApi = {
  getLocalProfile: () => ipcRenderer.invoke('profile:get') as Promise<LocalProfile>,
  setDisplayName: (displayName: string) => ipcRenderer.invoke('profile:set-name', displayName) as Promise<LocalProfile>,
  addFriendCode: (friendCode: string) => ipcRenderer.invoke('profile:add-friend', friendCode) as Promise<LocalProfile>,
  removeFriendCode: (friendCode: string) =>
    ipcRenderer.invoke('profile:remove-friend', friendCode) as Promise<LocalProfile>,
  listCaptureSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectCaptureSource: (sourceId: string) => ipcRenderer.invoke('capture:select-source', sourceId),
  listAudioProcesses: () => ipcRenderer.invoke('audio:list-processes'),
  startAudioCapture: (processId: number) => ipcRenderer.invoke('audio:start', processId),
  stopAudioCapture: () => ipcRenderer.invoke('audio:stop'),
  getEnvironment: () => ipcRenderer.invoke('environment:get'),
  setSignalingUrl: (signalingUrl: string) => ipcRenderer.invoke('environment:set-signaling-url', signalingUrl),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  setSessionActive: (active: boolean) => ipcRenderer.invoke('update:session-active', active),
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  onAudioChunk: (listener: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => listener(chunk)
    ipcRenderer.on('audio:chunk', handler)
    return () => ipcRenderer.removeListener('audio:chunk', handler)
  },
  onAudioState: (listener: (state: AudioBridgeState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AudioBridgeState) => listener(state)
    ipcRenderer.on('audio:state', handler)
    return () => ipcRenderer.removeListener('audio:state', handler)
  },
}

contextBridge.exposeInMainWorld('telae', api)
