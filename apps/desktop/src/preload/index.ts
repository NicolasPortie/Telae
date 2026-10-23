import { contextBridge, ipcRenderer } from 'electron'
import type { AccountInfo, AudioBridgeState, AudioChunk, LocalProfile, TelaeDesktopApi, UpdateStatus } from '../shared/contracts.ts'

const api: TelaeDesktopApi = {
  auth: {
    getSession: () => ipcRenderer.invoke('auth:session'),
    register: input => ipcRenderer.invoke('auth:register', input),
    verifyEmail: (identifier, code) => ipcRenderer.invoke('auth:verify-email', identifier, code),
    resendVerification: identifier => ipcRenderer.invoke('auth:resend-verification', identifier),
    login: (identifier, password) => ipcRenderer.invoke('auth:login', identifier, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    forgotPassword: identifier => ipcRenderer.invoke('auth:forgot-password', identifier),
    resetPassword: (identifier, code, newPassword) => ipcRenderer.invoke('auth:reset-password', identifier, code, newPassword),
    updateDisplayName: displayName => ipcRenderer.invoke('auth:update-display-name', displayName),
    changePassword: (currentPassword, newPassword) => ipcRenderer.invoke('auth:change-password', currentPassword, newPassword),
    deleteAccount: password => ipcRenderer.invoke('auth:delete-account', password),
    getAccessToken: () => ipcRenderer.invoke('auth:access-token'),
    onSessionChanged: (listener: (account: AccountInfo | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, account: AccountInfo | null) => listener(account)
      ipcRenderer.on('auth:changed', handler)
      return () => ipcRenderer.removeListener('auth:changed', handler)
    },
  },
  getLocalProfile: () => ipcRenderer.invoke('profile:get') as Promise<LocalProfile>,
  setDisplayName: (displayName: string) => ipcRenderer.invoke('profile:set-name', displayName) as Promise<LocalProfile>,
  listCaptureSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectCaptureSource: (sourceId: string) => ipcRenderer.invoke('capture:select-source', sourceId),
  resolveWindowAudioProcess: (sourceId: string) => ipcRenderer.invoke('capture:resolve-window-audio', sourceId),
  listAudioProcesses: () => ipcRenderer.invoke('audio:list-processes'),
  startAudioCapture: (processId: number, captureId: string) => ipcRenderer.invoke('audio:start', processId, captureId),
  startScreenAudioCapture: (captureId: string) => ipcRenderer.invoke('audio:start-screen', captureId),
  stopAudioCapture: (captureId: string) => ipcRenderer.invoke('audio:stop', captureId),
  getEnvironment: () => ipcRenderer.invoke('environment:get'),
  setSignalingUrl: (signalingUrl: string) => ipcRenderer.invoke('environment:set-signaling-url', signalingUrl),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  setSessionActive: (active: boolean) => ipcRenderer.invoke('update:session-active', active),
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  onAudioChunk: (listener: (chunk: AudioChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: AudioChunk) => listener(chunk)
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
