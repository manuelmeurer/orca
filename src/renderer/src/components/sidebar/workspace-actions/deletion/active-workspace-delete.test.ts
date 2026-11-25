import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWindowShortcutAction } from '../../../../../../shared/keybindings/window-shortcut-policy'
import { repo, worktree } from '../../worktree-list/grouping/worktree-list-groups-test-fixtures'

const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  runWorktreeDeleteWithToast: vi.fn()
}))

type Row = { id: string; hostId?: string }
function findRow(byRepo: Record<string, Row[]>, id: string, hostId?: string | null) {
  return Object.values(byRepo)
    .flat()
    .find((row) => row.id === id && (!hostId || row.hostId === hostId))
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state.get('active') } }))
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
import type { AppState } from '@/store/types'

type ShortcutTestState = Parameters<typeof deleteActiveWorkspaceFromShortcut>[0] &
  Pick<
    AppState,
    'clearWorktreeDeleteState' | 'openModal' | 'sshTargetLabels' | 'worktreeLineageById'
  > & {
    settings: Pick<NonNullable<AppState['settings']>, 'skipDeleteWorktreeConfirm'>
  }

const active = { ...worktree, id: 'active', instanceId: 'inc-active' }
const selected = { ...worktree, id: 'selected', instanceId: 'inc-selected' }
const openModal = vi.fn()
let state: ShortcutTestState

beforeEach(() => {
  openModal.mockReset()
  mocks.runWorktreeDeleteWithToast.mockReset()
  state = {
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
  mocks.state.set('active', state)
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
    state.settings = { skipDeleteWorktreeConfirm: false }
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(true)
    expect(mocks.runWorktreeDeleteWithToast).not.toHaveBeenCalled()
    expect(openModal).toHaveBeenCalledWith(
      'delete-worktree',
      expect.objectContaining({ worktreeId: active.id })
    )
  })

  it('deletes the active workspace right away when confirmation is off', () => {
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(true)
    expect(openModal).not.toHaveBeenCalled()
    expect(mocks.runWorktreeDeleteWithToast).toHaveBeenCalledWith(
      expect.objectContaining({ id: active.id }),
      active.displayName
    )
  })

  it('does nothing for the main worktree or while a modal is open', () => {
    state.worktreesByRepo = { [repo.id]: [{ ...active, isMainWorktree: true }] }
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(false)
    state.worktreesByRepo = { [repo.id]: [active] }
    state.activeModal = 'delete-worktree'
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(false)
    expect(openModal).not.toHaveBeenCalled()
  })

  it('never deletes a folder workspace', () => {
    state.activeWorktreeId = 'folder:notes'
    state.worktreesByRepo = { [repo.id]: [{ ...active, id: 'folder:notes' }] }
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(false)
    state.activeWorktreeId = active.id
    state.worktreesByRepo = { [repo.id]: [active] }
    state.repos = [{ ...repo, kind: 'folder' }]
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(false)
    expect(openModal).not.toHaveBeenCalled()
    expect(mocks.runWorktreeDeleteWithToast).not.toHaveBeenCalled()
  })

  it('ignores a folder project with the same id on another host', () => {
    const local = { ...active, hostId: 'local' as const }
    state.worktreesByRepo = { [repo.id]: [local] }
    state.repos = [
      { ...repo, executionHostId: 'local' },
      { ...repo, kind: 'folder', executionHostId: 'ssh:box' }
    ]
    expect(deleteActiveWorkspaceFromShortcut(state)).toBe(true)
    expect(mocks.runWorktreeDeleteWithToast).toHaveBeenCalledWith(
      expect.objectContaining({ id: active.id }),
      active.displayName
    )
  })
})
