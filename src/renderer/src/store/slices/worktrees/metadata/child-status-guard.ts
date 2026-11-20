import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { WorktreeSlice } from '../worktree-slice-contract'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'
import type { WorktreeMetaBatchUpdate } from './worktree-meta-update-options'
import { getIndexedAllWorktrees } from '../listing/worktree-catalog-index'
import { getSameStoreLineageParent } from '../../../../../../shared/worktree/lineage/workspace-lineage-graph'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../../../../../../shared/workspace/status/workspace-statuses'
import type { Worktree } from '../../../../../../shared/worktree/types'

// Custom rule: a child always has its parent's workspace status. The main-process store keeps
// it right on save; this keeps the cards from jumping and says why a child's move is refused.

type State = ReturnType<WorktreeSliceGet>

function statusOf(worktree: Pick<Worktree, 'workspaceStatus'>): string {
  return worktree.workspaceStatus ?? DEFAULT_WORKSPACE_STATUS_ID
}

/** Parents and children as the sidebar nests them, by valid same-host links only. */
function lineageView(state: State) {
  const rows = new Map<string, Worktree>()
  for (const row of getIndexedAllWorktrees(state.worktreesByRepo)) {
    rows.set(getWorktreeHostIdentity(row), row)
  }
  const parentOf = (row: Worktree): Worktree | undefined =>
    getSameStoreLineageParent(row, state.worktreeLineageById, rows)
  const children = new Map<string, Worktree[]>()
  for (const row of rows.values()) {
    const parent = parentOf(row)
    if (parent) {
      const key = getWorktreeHostIdentity(parent)
      children.set(key, [...(children.get(key) ?? []), row])
    }
  }
  return {
    parentOf,
    childrenOf: (row: Worktree) => children.get(getWorktreeHostIdentity(row)) ?? [],
    rowOf: (entry: WorktreeMetaBatchUpdate): Worktree | undefined => {
      const known = state.getKnownWorktreeById(entry.worktreeId, entry.executionHostId)
      return known ? rows.get(getWorktreeHostIdentity(known)) : undefined
    }
  }
}

type LineageView = ReturnType<typeof lineageView>

/** For callers that check many cards at once. */
export function worktreeParentFinder(state: State): (worktree: Worktree) => Worktree | undefined {
  return lineageView(state).parentOf
}

function depthOf(view: LineageView, row: Worktree | undefined): number {
  const seen = new Set<Worktree>()
  for (let parent = row && view.parentOf(row); parent; parent = view.parentOf(parent)) {
    if (seen.has(parent)) {
      break
    }
    seen.add(parent)
  }
  return seen.size
}

/** Drops a child's status that leaves its parent's, unless the parent moves there in the same
 * batch, and adds a parent's status for everything below it. Returned shallowest level first:
 * a remote server refuses a child's status until its parent has it. */
function withChildStatusRule(
  state: State,
  entries: readonly WorktreeMetaBatchUpdate[]
): WorktreeMetaBatchUpdate[][] {
  const view = lineageView(state)
  const movingTo = new Map<string, string>()
  for (const entry of entries) {
    if (entry.updates.workspaceStatus !== undefined) {
      movingTo.set(entry.worktreeId, entry.updates.workspaceStatus)
    }
  }
  let refusedParent: Worktree | undefined
  const result = entries.flatMap((entry): WorktreeMetaBatchUpdate[] => {
    const status = entry.updates.workspaceStatus
    const row = status === undefined ? undefined : view.rowOf(entry)
    const parent = row && view.parentOf(row)
    if (
      status === undefined ||
      !parent ||
      (movingTo.get(parent.id) ?? statusOf(parent)) === status
    ) {
      return [entry]
    }
    refusedParent ??= parent
    const { workspaceStatus: _dropped, ...rest } = entry.updates
    return Object.keys(rest).length === 0 ? [] : [{ ...entry, updates: rest }]
  })
  if (refusedParent) {
    toast.error(
      translate(
        'auto.store.slices.worktrees.statusFollowsParent',
        'Status follows the parent workspace {{value0}}. Change it there.',
        { value0: refusedParent.displayName || refusedParent.path }
      )
    )
  }
  for (const entry of result.slice()) {
    const workspaceStatus = entry.updates.workspaceStatus
    const row = workspaceStatus === undefined ? undefined : view.rowOf(entry)
    const pending = row ? view.childrenOf(row) : []
    for (const child of pending) {
      pending.push(...view.childrenOf(child).filter((next) => !pending.includes(next)))
      const index = result.findIndex((candidate) => candidate.worktreeId === child.id)
      if (index === -1) {
        result.push({
          worktreeId: child.id,
          updates: { workspaceStatus },
          executionHostId: child.hostId ?? entry.executionHostId
        })
      } else {
        result[index] = { ...result[index], updates: { ...result[index].updates, workspaceStatus } }
      }
    }
  }
  const levels: WorktreeMetaBatchUpdate[][] = []
  for (const entry of result) {
    // Only status writes wait for the level above; everything else goes in the first call.
    const depth = entry.updates.workspaceStatus === undefined ? 0 : depthOf(view, view.rowOf(entry))
    levels[depth] = [...(levels[depth] ?? []), entry]
  }
  return levels.filter(Boolean)
}

export function guardUpdateWorktreeMetaChildStatus(
  update: WorktreeSlice['updateWorktreeMeta'],
  get: WorktreeSliceGet
): WorktreeSlice['updateWorktreeMeta'] {
  return async (worktreeId, updates, options) => {
    if (updates.workspaceStatus === undefined) {
      return update(worktreeId, updates, options)
    }
    const levels = withChildStatusRule(get(), [
      { worktreeId, updates, executionHostId: options?.executionHostId }
    ])
    // Why: a write that was only the dropped status has nothing left to persist.
    let result: Awaited<ReturnType<typeof update>> = { ok: true }
    for (const entry of levels.flat()) {
      if (entry.worktreeId === worktreeId) {
        result = await update(worktreeId, entry.updates, options)
        if (!result.ok) {
          return result
        }
      } else {
        await update(entry.worktreeId, entry.updates, { executionHostId: entry.executionHostId })
      }
    }
    return result
  }
}

export function guardUpdateWorktreesMetaChildStatus(
  update: WorktreeSlice['updateWorktreesMeta'],
  get: WorktreeSliceGet
): WorktreeSlice['updateWorktreesMeta'] {
  return async (entries) => {
    if (entries.every((entry) => entry.updates.workspaceStatus === undefined)) {
      return update(entries)
    }
    for (const level of withChildStatusRule(get(), entries)) {
      await update(level)
    }
  }
}
