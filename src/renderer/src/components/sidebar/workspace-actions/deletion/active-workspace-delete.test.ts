import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWindowShortcutAction } from '../../../../../../shared/keybindings/window-shortcut-policy'
import { repo, worktree } from '../../worktree-list/grouping/worktree-list-groups-test-fixtures'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  runWorktreeDeleteWithToast: vi.fn()
}))

type Row = { id: string; hostId?: string }
function findRow(byRepo: Record<string, Row[]>, id: string, hostId?: string | null) {
  return Object.values(byRepo)
    .flat()
    .find((row) => row.id === id && (!hostId || row.hostId === hostId))
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/lib/workspace/ownership/qualified-worktree-execution-owner', () => ({
  resolveQualifiedWorktreeExecutionOwner: (
    byRepo: Record<string, Row[]>,
    _repos: unknown,
    id: string,
    hostId?: string | null
  ) => {
    const row = findRow(byRepo, id, hostId)
    return row ? { worktree: row } : null
  }
}))
vi.mock('@/store/workspaces/selection/worktree-on-host-selector', () => ({
  getWorktreeOnHostFromState: (state: { worktreesByRepo: Record<string, Row[]> }, id: string) =>
    findRow(state.worktreesByRepo, id)
}))
vi.mock('@/lib/workspace/ownership/worktree-operation-route', () => ({
  resolveWorktreeOperationRouteForHost: () => null
}))
vi.mock('./workspace-delete-lineage', () => ({
  getWorkspaceDeleteLineage: () => ({ descendants: [], deleteAllTargets: [] })
}))
vi.mock('@/components/editor/save/flush/removal-unsaved-editor-files', () => ({
  collectRemovalUnsavedFiles: () => []
}))
vi.mock('./run-worktree-delete-with-toast', () => ({
  runWorktreeDeleteWithToast: mocks.runWorktreeDeleteWithToast
}))

import { deleteActiveWorkspaceFromShortcut } from './active-workspace-delete'

const active = { ...worktree, id: 'active', instanceId: 'inc-active' }
const selected = { ...worktree, id: 'selected', instanceId: 'inc-selected' }
const openModal = vi.fn()

beforeEach(() => {
  openModal.mockReset()
  mocks.runWorktreeDeleteWithToast.mockReset()
  mocks.state = {
    activeModal: 'none',
    activeView: 'terminal',
    activeWorktreeId: active.id,
    activeWorkspaceExecutionHostId: null,
    activePendingCreationId: null,
    pendingWorktreeCreations: {},
    repos: [repo],
    worktreesByRepo: { [repo.id]: [selected, active] },
    worktreeLineageById: {},
    deleteStateByWorktreeId: {},
    sshTargetLabels: new Map(),
    settings: { skipDeleteWorktreeConfirm: true },
    clearWorktreeDeleteState: vi.fn(),
    openModal
  }
})

describe('workspace delete shortcut', () => {
  it.each([
    ['darwin', { meta: true, control: false }],
    ['linux', { meta: false, control: true }]
  ] as const)('claims Mod+Shift+Backspace globally on %s, even in a terminal', (platform, mods) => {
    const input = { key: 'Backspace', code: 'Backspace', alt: false, shift: true, ...mods }
    const terminal = { context: 'terminal', terminalShortcutPolicy: 'terminal-first' } as const
    expect(resolveWindowShortcutAction(input, platform)).toEqual({
      type: 'deleteCurrentWorkspace'
    })
    expect(resolveWindowShortcutAction(input, platform, {}, terminal)).toEqual({
      type: 'deleteCurrentWorkspace'
    })
  })

  it('asks before deleting the active workspace when confirmation is on', () => {
    mocks.state.settings = { skipDeleteWorktreeConfirm: false }
    expect(deleteActiveWorkspaceFromShortcut(mocks.state as never)).toBe(true)
    expect(mocks.runWorktreeDeleteWithToast).not.toHaveBeenCalled()
    expect(openModal).toHaveBeenCalledWith(
      'delete-worktree',
      expect.objectContaining({ worktreeId: active.id })
    )
  })

  it('deletes the active workspace right away when confirmation is off', () => {
    expect(deleteActiveWorkspaceFromShortcut(mocks.state as never)).toBe(true)
    expect(openModal).not.toHaveBeenCalled()
    expect(mocks.runWorktreeDeleteWithToast).toHaveBeenCalledWith(
      expect.objectContaining({ id: active.id }),
      active.displayName
    )
  })

  it('does nothing for the main worktree or while a modal is open', () => {
    mocks.state.worktreesByRepo = { [repo.id]: [{ ...active, isMainWorktree: true }] }
    expect(deleteActiveWorkspaceFromShortcut(mocks.state as never)).toBe(false)
    mocks.state.worktreesByRepo = { [repo.id]: [active] }
    mocks.state.activeModal = 'delete-worktree'
    expect(deleteActiveWorkspaceFromShortcut(mocks.state as never)).toBe(false)
    expect(openModal).not.toHaveBeenCalled()
  })
})
