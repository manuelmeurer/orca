// createManagedWorktree used to pick remote-vs-local from the raw `connectionId` field, so a repo
// stamped only `executionHostId: 'ssh:*'` ran `git worktree add` on the client against a remote
// path. That is the #11163 shape: read the execution host, never one spelling of it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

const createRuntimeLocalManagedWorktreeMock = vi.hoisted(() => vi.fn())
vi.mock('./runtime-local-worktree-create', () => ({
  createRuntimeLocalManagedWorktree: createRuntimeLocalManagedWorktreeMock
}))

import { OrcaRuntimeService } from './orca-runtime'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'

const TARGET_ID = 'remote-1'
const REMOTE_PATH = '/srv/app'

type RuntimeInternals = {
  resolveRepoSelector: (selector: string) => Promise<unknown>
  resolveLineageForWorktreeCreate: (input: unknown) => Promise<unknown>
  recordCreatedWorktreeLineage: (worktree: unknown, resolution: unknown) => unknown
}

function makeRuntime(repo: Record<string, unknown>): {
  runtime: OrcaRuntimeService
} {
  const store = {
    getSettings: () => ({ disabledTuiAgents: [], workspaceDir: '/tmp/workspaces' }),
    getProjectHostSetups: () => []
  }
  const runtime = new OrcaRuntimeService(store as never)
  const internals = runtime as unknown as RuntimeInternals
  vi.spyOn(internals, 'resolveRepoSelector').mockResolvedValue(repo)
  vi.spyOn(internals, 'resolveLineageForWorktreeCreate').mockResolvedValue({
    kind: 'none',
    warnings: []
  })
  vi.spyOn(internals, 'recordCreatedWorktreeLineage').mockReturnValue({
    lineage: null,
    workspaceLineage: null,
    warnings: []
  })
  return { runtime }
}

describe('createManagedWorktree execution-host routing', () => {
  beforeEach(() => {
    createRuntimeLocalManagedWorktreeMock.mockReset()
    // Name the defect in the failure output: reaching this mock means a remote repo was routed
    // into a client-side `git worktree add`.
    createRuntimeLocalManagedWorktreeMock.mockRejectedValue(
      new Error('local_worktree_create_ran_for_remote_repo')
    )
  })

  it('refuses a repo stamped with executionHostId only without creating locally', async () => {
    const { runtime } = makeRuntime({
      id: 'repo-remote',
      path: REMOTE_PATH,
      kind: 'git',
      executionHostId: `ssh:${TARGET_ID}`
    })

    await expect(
      runtime.createManagedWorktree({ repoSelector: 'repo-remote', name: 'feature' } as never)
    ).rejects.toBeInstanceOf(SshHostNotServedError)

    expect(createRuntimeLocalManagedWorktreeMock).not.toHaveBeenCalled()
  })

  it('refuses a legacy connectionId-only SSH repo without creating locally', async () => {
    const { runtime } = makeRuntime({
      id: 'repo-remote',
      path: REMOTE_PATH,
      kind: 'git',
      connectionId: TARGET_ID
    })

    await expect(
      runtime.createManagedWorktree({ repoSelector: 'repo-remote', name: 'feature' } as never)
    ).rejects.toBeInstanceOf(SshHostNotServedError)

    expect(createRuntimeLocalManagedWorktreeMock).not.toHaveBeenCalled()
  })
})
