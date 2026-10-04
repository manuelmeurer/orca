import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

const createLocalMock = vi.hoisted(() => vi.fn())
vi.mock('./runtime-local-worktree-create', () => ({
  createRuntimeLocalManagedWorktree: createLocalMock
}))

import { OrcaRuntimeService } from './orca-runtime'

type RuntimeInternals = {
  resolveRepoSelector: (selector: string) => Promise<unknown>
  resolveLineageForWorktreeCreate: (input?: unknown) => Promise<unknown>
}

describe('managed worktree create execution host', () => {
  it('does not try a local create for an SSH repo the runtime cannot serve', async () => {
    createLocalMock.mockReset()
    const store = {
      getSettings: () => ({ disabledTuiAgents: [], workspaceDir: '/tmp/workspaces' }),
      getProjectHostSetups: () => []
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the create path only reads these two store methods before refusing the SSH target.
    const runtime = new OrcaRuntimeService(store as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exposes protected members for stubbing, matching other create-path tests.
    const internals = runtime as unknown as RuntimeInternals
    vi.spyOn(internals, 'resolveRepoSelector').mockResolvedValue({
      id: 'repo-remote',
      path: '/srv/app',
      kind: 'git',
      executionHostId: 'ssh:remote-1',
      connectionId: 'remote-1'
    })
    vi.spyOn(internals, 'resolveLineageForWorktreeCreate').mockResolvedValue({
      kind: 'none',
      warnings: []
    })

    await expect(
      runtime.createManagedWorktree({ repoSelector: 'repo-remote', name: 'feature' } as never)
    ).rejects.toMatchObject({ code: 'ssh_host_not_served' })

    expect(createLocalMock).not.toHaveBeenCalled()
  })
})
