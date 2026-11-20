import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import type { Repo } from '../../../../shared/repository/repo-types'
import { getRepoIdFromWorktreeId, splitWorktreeId } from '../../../../shared/worktree/id'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import type { WorkspaceStatus } from '../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../../../../shared/workspace/status/workspace-statuses'
import { readAllWorktreeMetaForHost } from '../../../persistence/host-qualified-worktree-meta'
import { pendingWorktreeRemovals } from '../../../workspaces/removal/worktree-removal-table'
import { RuntimeLineageError } from './runtime-lineage-error'
import type { WorktreeLineageResolution } from './runtime-worktree-lineage-resolution'

// Custom rules: children are one level deep, one per repository, never in the parent's
// repository, and always in their parent's workspace status.

export const LINEAGE_CHILD_DEPTH = 'LINEAGE_CHILD_DEPTH'
export const LINEAGE_CHILD_REPO_TAKEN = 'LINEAGE_CHILD_REPO_TAKEN'
export const LINEAGE_CHILD_SAME_REPO = 'LINEAGE_CHILD_SAME_REPO'
export const LINEAGE_STATUS_FOLLOWS_PARENT = 'LINEAGE_STATUS_FOLLOWS_PARENT'

type LineageById = Readonly<Record<string, WorktreeLineage>>
type MetaById = Readonly<Record<string, Pick<WorktreeMeta, 'instanceId'> | undefined>>

/** Only a valid link counts: a removed parent leaves its children's rows with stale instance ids. */
export function linkedParentWorktreeId(
  lineageById: LineageById,
  metaById: MetaById,
  worktreeId: string
): string | undefined {
  const lineage = lineageById[worktreeId]
  if (
    !lineage ||
    lineage.parentWorktreeId === worktreeId ||
    metaById[worktreeId]?.instanceId !== lineage.worktreeInstanceId ||
    metaById[lineage.parentWorktreeId]?.instanceId !== lineage.parentWorktreeInstanceId
  ) {
    return undefined
  }
  return lineage.parentWorktreeId
}

export function childWorktreeIds(
  lineageById: LineageById,
  metaById: MetaById,
  worktreeId: string
): string[] {
  return Object.keys(lineageById).filter(
    (id) => linkedParentWorktreeId(lineageById, metaById, id) === worktreeId
  )
}

/** All levels: older trees can be deeper than the rules now allow. */
export function descendantWorktreeIds(
  lineageById: LineageById,
  metaById: MetaById,
  worktreeId: string
): string[] {
  const seen = new Set([worktreeId])
  const pending = [worktreeId]
  for (const id of pending) {
    for (const child of childWorktreeIds(lineageById, metaById, id)) {
      if (!seen.has(child)) {
        seen.add(child)
        pending.push(child)
      }
    }
  }
  return pending.slice(1)
}

export function workspaceStatusOf(
  meta: Pick<WorktreeMeta, 'workspaceStatus'> | undefined
): WorkspaceStatus {
  return meta?.workspaceStatus ?? DEFAULT_WORKSPACE_STATUS_ID
}

/** Undefined for a worktree without a valid parent link. */
export function parentWorkspaceStatus(
  lineageById: LineageById,
  metaById: Readonly<Record<string, WorktreeMeta | undefined>>,
  worktreeId: string
): WorkspaceStatus | undefined {
  const parentId = linkedParentWorktreeId(lineageById, metaById, worktreeId)
  return parentId ? workspaceStatusOf(metaById[parentId]) : undefined
}

type ChildWorktreeRulesStore = {
  getAllWorktreeMeta: () => Record<string, WorktreeMeta>
  getAllWorktreeMetaForHost?: (executionHostId: ExecutionHostId) => Record<string, WorktreeMeta>
  getAllWorktreeLineage?: () => Record<string, WorktreeLineage>
  getRepo?: (repoId: string) => Repo | undefined
}

function readLineage(
  store: ChildWorktreeRulesStore,
  hostId: ExecutionHostId | undefined
): { lineageById: LineageById; metaById: Record<string, WorktreeMeta> } {
  return {
    lineageById: store.getAllWorktreeLineage?.() ?? {},
    metaById: hostId ? readAllWorktreeMetaForHost(store, hostId) : store.getAllWorktreeMeta()
  }
}

function worktreePath(worktreeId: string): string {
  return splitWorktreeId(worktreeId)?.worktreePath ?? worktreeId
}

function refuse(code: string, message: string, hint: string, existing?: string): never {
  throw new RuntimeLineageError(code, `${message} ${hint}`, {
    nextSteps: [hint],
    ...(existing ? { existingWorktree: { id: existing, path: worktreePath(existing) } } : {})
  })
}

/** Refuses a worktree parent the rules forbid; `childId` is set when an existing worktree moves. */
export function assertChildWorktreeAllowed(args: {
  store: ChildWorktreeRulesStore
  hostId?: ExecutionHostId
  parentId: string
  childRepoId: string
  childId?: string
}): void {
  const { store, parentId, childRepoId, childId } = args
  const { lineageById, metaById } = readLineage(store, args.hostId)
  const parentOf = (id: string): string | undefined =>
    linkedParentWorktreeId(lineageById, metaById, id)
  let top = parentId
  const seen = new Set([top])
  for (let next = parentOf(top); next && !seen.has(next); next = parentOf(next)) {
    seen.add(next)
    top = next
  }
  if (top !== parentId) {
    refuse(
      LINEAGE_CHILD_DEPTH,
      `Only top-level workspaces can have children. ${worktreePath(parentId)} is a child of ${worktreePath(top)}.`,
      `Create it under ${worktreePath(top)}: --parent-worktree id:${top}`
    )
  }
  if (childId && childWorktreeIds(lineageById, metaById, childId).length > 0) {
    refuse(
      LINEAGE_CHILD_DEPTH,
      `${worktreePath(childId)} has child workspaces, so it can't become a child.`,
      'Keep it top-level, or move its children first.'
    )
  }
  if (getRepoIdFromWorktreeId(parentId) === childRepoId) {
    refuse(
      LINEAGE_CHILD_SAME_REPO,
      "A workspace can't have a child in its own repository.",
      `Work in ${worktreePath(parentId)}, or pass --no-parent for independent work.`
    )
  }
  const taken = childWorktreeIds(lineageById, metaById, parentId).find(
    (id) =>
      id !== childId &&
      getRepoIdFromWorktreeId(id) === childRepoId &&
      !metaById[id]?.isArchived &&
      // A child being deleted is on its way out; a replacement may take its place.
      !pendingWorktreeRemovals.has(id)
  )
  if (taken) {
    const repo = store.getRepo?.(childRepoId)?.displayName || childRepoId
    refuse(
      LINEAGE_CHILD_REPO_TAKEN,
      `${repo} already has a child for this workspace: ${worktreePath(taken)}.`,
      'Use it.',
      taken
    )
  }
}

type HostTarget = { readonly id: string; readonly hostId: ExecutionHostId }

/** A child's own status write is refused when it differs from its parent's. */
export function assertStatusFollowsParent(
  store: ChildWorktreeRulesStore,
  target: HostTarget,
  workspaceStatus: string
): void {
  const { lineageById, metaById } = readLineage(store, target.hostId)
  const parentId = linkedParentWorktreeId(lineageById, metaById, target.id)
  if (!parentId) {
    return
  }
  const parentStatus = workspaceStatusOf(metaById[parentId])
  if (parentStatus !== workspaceStatus) {
    refuse(
      LINEAGE_STATUS_FOLLOWS_PARENT,
      `Status follows the parent workspace ${worktreePath(parentId)} (${parentStatus}).`,
      'Change it there.'
    )
  }
}

/** The repositories below a worktree, other than its own, whose rows a status change moved. */
export function otherRepoIdsBelow(store: ChildWorktreeRulesStore, target: HostTarget): string[] {
  const { lineageById, metaById } = readLineage(store, target.hostId)
  const ownRepoId = getRepoIdFromWorktreeId(target.id)
  const repoIds = descendantWorktreeIds(lineageById, metaById, target.id).map(
    getRepoIdFromWorktreeId
  )
  return [...new Set(repoIds)].filter((repoId) => repoId !== ownRepoId)
}

/** Checks a create's resolved parent, guessed or explicit, before anything is created. */
export function withAllowedCreateParent(
  store: ChildWorktreeRulesStore | null,
  resolution: WorktreeLineageResolution,
  childRepo: Repo | undefined
): WorktreeLineageResolution {
  if (
    store &&
    childRepo &&
    resolution.kind === 'lineage' &&
    resolution.parent.type === 'worktree'
  ) {
    assertChildWorktreeAllowed({
      store,
      hostId: getRepoExecutionHostId(childRepo),
      parentId: resolution.parent.worktree.id,
      childRepoId: childRepo.id
    })
  }
  return resolution
}

function knownWorktreeParentId(
  store: ChildWorktreeRulesStore,
  parentWorkspace: string | undefined
): string | undefined {
  const scope = parentWorkspace ? parseWorkspaceKey(parentWorkspace) : null
  return scope?.type === 'worktree' && store.getAllWorktreeMeta()[scope.worktreeId]
    ? scope.worktreeId
    : undefined
}

/** The create dialog's picked parent; a missing parent is left to the caller's warning. */
export function assertCreateDialogParentAllowed(
  store: ChildWorktreeRulesStore,
  parentWorkspace: string | undefined,
  childWorkspaceKey: string
): void {
  const parentId = knownWorktreeParentId(store, parentWorkspace)
  const childScope = parseWorkspaceKey(childWorkspaceKey)
  if (parentId && childScope?.type === 'worktree') {
    assertChildWorktreeAllowed({
      store,
      parentId,
      childRepoId: getRepoIdFromWorktreeId(childScope.worktreeId)
    })
  }
}

/** The status the store will copy from the dialog's picked parent, so the returned row agrees. */
export function createDialogChildStatus(
  store: ChildWorktreeRulesStore,
  parentWorkspace: string | undefined
): Pick<WorktreeMeta, 'workspaceStatus'> {
  const parentId = knownWorktreeParentId(store, parentWorkspace)
  return parentId
    ? { workspaceStatus: workspaceStatusOf(store.getAllWorktreeMeta()[parentId]) }
    : {}
}
