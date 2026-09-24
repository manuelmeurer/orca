import { expect, it, vi } from 'vitest'
import { createDesktopTerminal } from './orca-runtime-create-terminal-desktop'

const desktop = vi.hoisted(() => ({ onIpc: vi.fn(), removeIpcListener: vi.fn() }))
vi.mock('./runtime-desktop-surface', () => ({ getRuntimeDesktopSurface: () => desktop }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, ipcMain: {} }))

it('carries first placement through desktop IPC for an SSH folder workspace', async () => {
  const webContents = {
    send: vi.fn((_channel, payload) => {
      desktop.onIpc.mock.calls[0][1](
        { sender: webContents },
        {
          requestId: payload.requestId,
          tabId: 'new-tab',
          title: 'Codex'
        }
      )
    })
  }
  const window = { webContents }
  const workspace = { id: 'folder:ssh-project', path: '/remote/project', connectionId: 'ssh-1' }
  const runtime = {
    assertGraphReady: vi.fn(),
    getAuthoritativeWindow: () => window,
    resolveTerminalWorkspaceLaunchScope: vi.fn().mockResolvedValue(workspace),
    resolveAgentTerminalCreateOptions: vi.fn(async (_workspace, opts) => opts),
    resolveWorkspaceTerminalStartupCwd: () => undefined,
    waitForTerminalHandle: vi.fn().mockResolvedValue('term_new'),
    handles: new Map(),
    getPtyExecutionHostMetadata: () => ({})
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: All runtime members touched by desktop creation are implemented above.
  const host = runtime as unknown as Parameters<typeof createDesktopTerminal>[0]
  await createDesktopTerminal(
    host,
    'folder:ssh-project',
    { command: 'codex', position: 'first' },
    undefined,
    null
  )
  expect(webContents.send).toHaveBeenCalledWith(
    'terminal:requestTabCreate',
    expect.objectContaining({
      worktreeId: 'folder:ssh-project',
      command: 'codex',
      position: 'first',
      activate: false
    })
  )
  expect(desktop.removeIpcListener).toHaveBeenCalled()
})
