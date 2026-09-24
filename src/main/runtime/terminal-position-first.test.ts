import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeWithCreateTerminal } from './orca-runtime-create-terminal'
import { createDesktopTerminal } from './orca-runtime-create-terminal-desktop'
import { TERMINAL_LIFECYCLE_METHODS } from './rpc/methods/terminal/terminal-lifecycle-methods'
import type { TerminalCreateOptions } from './runtime-terminal-contracts'

vi.mock('./orca-runtime-create-terminal-desktop', () => ({ createDesktopTerminal: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: {} }))

describe('terminal first placement runtime routing', () => {
  it.each([undefined, 'codex'])(
    'uses the desktop path for %s, retaining workspace and focus',
    async (command) => {
      const window = {}
      const runtime = { getAvailableAuthoritativeWindow: () => window }
      const opts: TerminalCreateOptions = { position: 'first', command, focus: false }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The selected desktop branch only reads getAvailableAuthoritativeWindow; desktop creation is mocked.
      const host = runtime as unknown as OrcaRuntimeWithCreateTerminal
      await OrcaRuntimeWithCreateTerminal.prototype.createTerminal.call(
        host,
        'folder:folder-1',
        opts
      )
      expect(createDesktopTerminal).toHaveBeenLastCalledWith(
        runtime,
        'folder:folder-1',
        {
          ...opts,
          rendererBacked: true
        },
        undefined,
        window
      )
    }
  )

  it('refuses headless placement before any spawn', async () => {
    const spawn = vi.fn()
    const runtime = { getAvailableAuthoritativeWindow: () => null, ptyController: { spawn } }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The refusal path only reads getAvailableAuthoritativeWindow.
    const host = runtime as unknown as OrcaRuntimeWithCreateTerminal
    await expect(
      OrcaRuntimeWithCreateTerminal.prototype.createTerminal.call(host, 'folder:folder-1', {
        position: 'first'
      })
    ).rejects.toThrow('requires a desktop terminal surface')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('forwards validated placement through the RPC method while suppressing remote focus', async () => {
    const method = TERMINAL_LIFECYCLE_METHODS.find(
      (candidate) => candidate.name === 'terminal.create'
    )
    if (!method) {
      throw new Error('Missing terminal.create')
    }
    const createTerminal = vi.fn().mockResolvedValue({ handle: 'new-terminal' })
    const runtime = {
      createTerminal,
      dedupeTerminalCreate: async (
        _caller: string,
        selector: string,
        _mutation: unknown,
        _reconcile: boolean,
        create: (selector: string) => unknown
      ) => create(selector)
    }
    const params = method.params.parse({
      worktree: 'folder:folder-1',
      position: 'first',
      focus: true
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: terminal.create only consumes these runtime methods and caller metadata.
    await method.handler(params, { runtime, clientKind: 'desktop' } as unknown as Parameters<
      typeof method.handler
    >[1])
    expect(createTerminal).toHaveBeenCalledWith(
      'folder:folder-1',
      expect.objectContaining({ position: 'first', focus: false })
    )
  })
})
