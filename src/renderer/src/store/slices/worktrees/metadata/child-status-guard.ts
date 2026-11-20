import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { WorktreeSlice } from '../worktree-slice-contract'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'
import type { WorktreeMetaBatchUpdate } from './worktree-meta-update-options'
import { getIndexedAllWorktrees } from '../listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '../../../workspaces/catalog/workspace-record-fields'
import { getSameStoreLineageParent } from '../../../../../../shared/worktree/lineage/workspace-lineage-graph'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../../../shared/worktree/host-qualified-identity'
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
  for (const row of getIndexedAllWorktrees(selectWorktreesByRepo(state))) {
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
  const rowOf = (entry: WorktreeMetaBatchUpdate): Worktree | undefined => {
    const known = state.getKnownWorktreeById(entry.worktreeId, entry.executionHostId)
    return known ? rows.get(getWorktreeHostIdentity(known)) : undefined
  }
  return {
    parentOf,
    childrenOf: (row: Worktree) => children.get(getWorktreeHostIdentity(row)) ?? [],
    rowOf,
    /** One host's copy of the entry's worktree: same-id worktrees on other hosts never match. */
    identityOf: (entry: WorktreeMetaBatchUpdate) => {
      const row = rowOf(entry)
      return row
        ? getWorktreeHostIdentity(row)
        : composeWorktreeHostIdentity(entry.executionHostId, entry.worktreeId)
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
 * batch, and adds a parent's status for everything below it. Resolved top-down: a move is checked
 * against its parent's final status (an older, deeper tree can carry moves at several levels),
 * so every worktree ends with its parent's status. Returned shallowest level first: a remote
 * server refuses a child's status until its parent has it. */
function withChildStatusRule(
  state: State,
  entries: readonly WorktreeMetaBatchUpdate[]
): WorktreeMetaBatchUpdate[][] {
  const view = lineageView(state)
  const final = new Map<string, string>()
  const descendants = new Map<string, WorktreeMetaBatchUpdate>()
  const dropped = new Set<WorktreeMetaBatchUpdate>()
  let refusedParent: Worktree | undefined
  const moves = entries
    .flatMap((entry, index) => {
      const status = entry.updates.workspaceStatus
      return status === undefined ? [] : [{ entry, status, index, row: view.rowOf(entry) }]
    })
    .sort((a, b) => depthOf(view, a.row) - depthOf(view, b.row) || a.index - b.index)
  for (const { entry, status, row } of moves) {
    const parent = row && view.parentOf(row)
    if (parent && (final.get(getWorktreeHostIdentity(parent)) ?? statusOf(parent)) !== status) {
      refusedParent ??= parent
      dropped.add(entry)
      continue
    }
    if (!row) {
      continue
    }
    final.set(getWorktreeHostIdentity(row), status)
    const pending = view.childrenOf(row)
    for (const child of pending) {
      pending.push(...view.childrenOf(child).filter((next) => !pending.includes(next)))
      const key = getWorktreeHostIdentity(child)
      final.set(key, status)
      descendants.set(key, {
        worktreeId: child.id,
        updates: { workspaceStatus: status },
        executionHostId: child.hostId ?? entry.executionHostId
      })
    }
  }
  if (refusedParent) {
    toast.error(
      translate(
        'auto.store.slices.worktrees.statusFollowsParent',
        'Status follows the parent workspace {{value0}}. Change it there.',
        { value0: refusedParent.displayName || refusedParent.path }
      )
    )
  }
  const result = entries.flatMap((entry): WorktreeMetaBatchUpdate[] => {
    const identity = view.identityOf(entry)
    descendants.delete(identity)
    // A dropped move still takes the status an ancestor's move brings down.
    const workspaceStatus = final.get(identity)
    if (dropped.has(entry) && workspaceStatus === undefined) {
      const { workspaceStatus: _dropped, ...rest } = entry.updates
      return Object.keys(rest).length === 0 ? [] : [{ ...entry, updates: rest }]
    }
    return [
      workspaceStatus === undefined
        ? entry
        : { ...entry, updates: { ...entry.updates, workspaceStatus } }
    ]
  })
  result.push(...descendants.values())
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
    const state = get()
    const origin = { worktreeId, updates, executionHostId: options?.executionHostId }
    const levels = withChildStatusRule(state, [origin])
    const view = lineageView(state)
    const originIdentity = view.identityOf(origin)
    // Why: a write that was only the dropped status has nothing left to persist.
    let result: Awaited<ReturnType<typeof update>> = { ok: true }
    for (const entry of levels.flat()) {
      if (view.identityOf(entry) === originIdentity) {
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
