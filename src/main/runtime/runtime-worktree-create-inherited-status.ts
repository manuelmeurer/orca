import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { WorktreeLineageResolution } from './runtime-worktree-lineage-resolution'

// Why: a child that starts in the default status lands in a different status lane than its
// parent, splitting the lineage group until someone moves it by hand.
export function withParentWorkspaceStatus(
  request: RuntimeManagedWorktreeCreateArgs,
  lineage: WorktreeLineageResolution
): RuntimeManagedWorktreeCreateArgs {
  if (request.workspaceStatus !== undefined || lineage.kind !== 'lineage') {
    return request
  }
  const { parent } = lineage
  const workspaceStatus =
    parent.type === 'worktree'
      ? parent.worktree.workspaceStatus
      : parent.folderWorkspace.workspaceStatus
  return workspaceStatus ? { ...request, workspaceStatus } : request
}
