import type { WorkspaceAttachmentMutation } from '../../../../shared/workspace-attachments/workspace-attachment-mutation'
import type { DiffCommentBaseMutation } from '../../../../shared/file-review/diff-comment-mutation'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { WorkspaceStatus } from '../../../../shared/worktree/types'
import type { HostWorktreeTarget } from '../../../../shared/worktree/host-qualified-identity'
import {
  descendantWorktreeIds,
  parentWorkspaceStatus,
  workspaceStatusOf
} from '../../../runtime/workspaces/lineage/child-worktree-rules'
import type { StoreRuntimeState } from '../store-runtime-state'
import type { WriteSchedulingOperations } from '../profile-writing/write-scheduling'
import {
  getAllWorktreeMetaForHost,
  setWorktreeMetaForHost
} from '../worktree-metadata/worktree-identity-metadata'

// Custom rule: a child always has its parent's workspace status. Kept where metadata is saved,
// so every write path follows it and no save order matters.

type Runtime = Pick<StoreRuntimeState, 'state'>
type MetaWrite = Partial<WorktreeMeta> & WorkspaceAttachmentMutation & DiffCommentBaseMutation

function statusOfParent(runtime: Runtime, target: HostWorktreeTarget): WorkspaceStatus | undefined {
  const metaById = getAllWorktreeMetaForHost(runtime, target.hostId)
  return parentWorkspaceStatus(runtime.state.worktreeLineageById, metaById, target.id)
}

/** Follow-up writes after the main one is saved: one that fails must not fail that write. */
function writeStatus(
  runtime: Runtime,
  scheduling: WriteSchedulingOperations,
  target: HostWorktreeTarget,
  worktreeId: string,
  workspaceStatus: WorkspaceStatus
): void {
  try {
    setWorktreeMetaForHost(runtime, scheduling, worktreeId, target.hostId, { workspaceStatus })
  } catch (error) {
    console.error('[worktree-meta] parent status could not be copied:', error)
  }
}

/** Every level, archived worktrees included: an unarchived or older nested worktree must already
 * sit in its parent's column. */
function writeStatusBelow(
  runtime: Runtime,
  scheduling: WriteSchedulingOperations,
  target: HostWorktreeTarget,
  workspaceStatus: WorkspaceStatus
): void {
  const metaById = getAllWorktreeMetaForHost(runtime, target.hostId)
  for (const id of descendantWorktreeIds(runtime.state.worktreeLineageById, metaById, target.id)) {
    if (workspaceStatusOf(metaById[id]) !== workspaceStatus) {
      writeStatus(runtime, scheduling, target, id, workspaceStatus)
    }
  }
}

/** A child's status write takes its parent's status; a status write reaches everything below. */
export function setWorktreeMetaFollowingParent(
  runtime: Runtime,
  scheduling: WriteSchedulingOperations,
  target: HostWorktreeTarget,
  meta: MetaWrite
): WorktreeMeta {
  if (meta.workspaceStatus === undefined) {
    return setWorktreeMetaForHost(runtime, scheduling, target.id, target.hostId, meta)
  }
  const workspaceStatus = statusOfParent(runtime, target) ?? meta.workspaceStatus
  const updated = setWorktreeMetaForHost(runtime, scheduling, target.id, target.hostId, {
    ...meta,
    workspaceStatus
  })
  writeStatusBelow(runtime, scheduling, target, workspaceStatus)
  return updated
}

/** A new parent link brings the child, and anything below it, into the parent's status. */
export function followParentStatus(
  runtime: Runtime,
  scheduling: WriteSchedulingOperations,
  target: HostWorktreeTarget
): void {
  const workspaceStatus = statusOfParent(runtime, target)
  if (workspaceStatus === undefined) {
    return
  }
  const current = getAllWorktreeMetaForHost(runtime, target.hostId)[target.id]
  if (workspaceStatusOf(current) !== workspaceStatus) {
    writeStatus(runtime, scheduling, target, target.id, workspaceStatus)
  }
  writeStatusBelow(runtime, scheduling, target, workspaceStatus)
}
