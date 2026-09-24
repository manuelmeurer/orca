import type { BrowserWindow } from 'electron'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'

export function resolveTerminalCreateSurface(
  worktreeSelector: string | undefined,
  options: TerminalCreateOptions,
  window: BrowserWindow | null
): { options: TerminalCreateOptions; window: BrowserWindow | null; background: boolean } {
  if (options.position === 'first') {
    if (!window || options.agentSessionClaim) {
      throw new Error(
        '--position first requires a desktop terminal surface; no terminal was created.'
      )
    }
    options = { ...options, rendererBacked: true }
  }
  const requiresFocus = options.presentation === 'focused' || options.focus === true
  return {
    options,
    window: options.rendererBacked === true ? window : null,
    background:
      worktreeSelector !== undefined &&
      (Boolean(options.agentSessionClaim) ||
        (!requiresFocus && options.rendererBacked !== true) ||
        window === null)
  }
}
