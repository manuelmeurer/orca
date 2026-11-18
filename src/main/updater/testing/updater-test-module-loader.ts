import { vi } from 'vitest'

export async function loadUpdaterModule() {
  vi.resetModules()
  return import('../updater-service')
}
