import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { resolveQualifiedWorktreeExecutionOwner } from '@/lib/workspace/ownership/qualified-worktree-execution-owner'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import type { AppState } from '@/store/types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { runWorktreeDelete } from './delete-worktree-flow'
import { getDeleteStateForWorktreeHost } from './worktree-delete-state-host-match'

type ActiveWorkspaceDeleteState = Pick<
  AppState,
  | 'activeModal'
  | 'activeWorktreeId'
  | 'activeWorkspaceExecutionHostId'
  | 'activeView'
  | 'activePendingCreationId'
  | 'pendingWorktreeCreations'
  | 'repos'
  | 'deleteStateByWorktreeId'
  | 'worktreesByRepo'
>

/** The Git worktree shown in the main area; sidebar selection and focus never pick the target. */
export function selectActiveWorkspaceDeleteTarget(
  state: ActiveWorkspaceDeleteState
): Worktree | null {
  if (
    state.activeModal !== 'none' ||
    state.activeView !== 'terminal' ||
    !state.activeWorktreeId ||
    selectWorktreeCreationSurfaceShown(state)
  ) {
    return null
  }
  const worktree = resolveQualifiedWorktreeExecutionOwner(
    selectWorktreesByRepo(state),
    state.repos,
    state.activeWorktreeId,
    state.activeWorkspaceExecutionHostId
  )?.worktree
  return worktree &&
    !worktree.isMainWorktree &&
    !getDeleteStateForWorktreeHost(worktree, state.deleteStateByWorktreeId)?.isDeleting
    ? worktree
    : null
}

/** Global Mod+Shift+Backspace; honors the delete-confirmation preference like the context menu. */
export function deleteActiveWorkspaceFromShortcut(state: ActiveWorkspaceDeleteState): boolean {
  const worktree = selectActiveWorkspaceDeleteTarget(state)
  if (!worktree) {
    return false
  }
  runWorktreeDelete(worktree.id, {
    expectedInstanceId: worktree.instanceId,
    ...(worktree.hostId ? { expectedHostId: worktree.hostId } : {})
  })
  return true
}
