import type { WorktreeCreationRequest } from './pending-worktree-creation'

export function resolveWorktreeCreationExecutionHostId(
  request: Pick<WorktreeCreationRequest, 'workspaceRunContext' | 'executionHostId'>
) {
  if (
    request.workspaceRunContext &&
    request.executionHostId &&
    request.workspaceRunContext.hostId !== request.executionHostId
  ) {
    throw new Error('Conflicting workspace creation hosts.')
  }
  return request.workspaceRunContext?.hostId ?? request.executionHostId
}
