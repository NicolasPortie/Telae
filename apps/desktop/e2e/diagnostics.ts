import type { Page } from '@playwright/test'
import type { DiagnosticsSnapshot } from '../src/services/types.ts'

type DiagnosticExport = { snapshot: { diagnostics: DiagnosticsSnapshot }; samples: unknown[] }
type SessionTelemetry = { getSnapshot: () => unknown }
type TelemetryHistory = { export: (snapshot: unknown) => DiagnosticExport }

// Read internal telemetry for benchmarks without exposing diagnostic controls in the UI.
export async function diagnosticSnapshot(page: Page) {
  return page.evaluate(() => {
    type Hook = { memoizedState: unknown; next: Hook | null }
    type Fiber = { memoizedState: Hook | null; return: Fiber | null }
    const element = document.querySelector('main')
    if (!element) throw new Error('Tela principal ausente')
    const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'))
    let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : null
    while (fiber) {
      const firstState = fiber.memoizedState?.memoizedState
      if (firstState && typeof firstState === 'object' && 'getSnapshot' in firstState) break
      fiber = fiber.return
    }
    if (!fiber) throw new Error('Componente App ausente')
    let controller: SessionTelemetry | undefined
    let history: TelemetryHistory | undefined
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const value = hook.memoizedState
      if (!value || typeof value !== 'object') continue
      if ('getSnapshot' in value) controller = value as SessionTelemetry
      if ('current' in value) {
        const current = (value as { current: unknown }).current
        if (current && typeof current === 'object' && 'recordEvent' in current && 'export' in current) {
          history = current as TelemetryHistory
        }
      }
    }
    if (!controller || !history) throw new Error('Telemetria interna ausente')
    return history.export(controller.getSnapshot())
  })
}
