import { getWorktreeOnHostFromState } from '@/store/selectors'
import type { AppState } from '@/store/types'
import { getProjectedWorktreeLineage } from './worktree-lineage-projection'
import {
  getWorktreeLineageRuntimeOwner,
  isValidResolvedWorktreeLineageEdge
} from '../../../../shared/resolved-worktree-lineage'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../../shared/worktree/types'

type WorktreeDeleteLineageTarget = Pick<
  Worktree,
  'id' | 'repoId' | 'path' | 'hostId' | 'runtimeOwnerEnvironmentId'
>
type WorktreeDeleteLineageSnapshot = Pick<AppState, 'worktreesByRepo' | 'worktreeLineageById'>

export function isStrictWorktreeDescendantPath(parentPath: string, childPath: string): boolean {
  return (
    normalizeRuntimePathForComparison(parentPath) !==
      normalizeRuntimePathForComparison(childPath) && isPathInsideOrEqual(parentPath, childPath)
  )
}

export function buildWorktreeDeleteLineageDependencies<T extends WorktreeDeleteLineageTarget>(
  targets: readonly T[],
  hostFor: (target: T) => string | undefined,
  snapshot: WorktreeDeleteLineageSnapshot
): Map<string, T[]> {
  const dependencies = new Map<string, T[]>()
  for (const parent of targets) {
    const children = targets.filter((child) => {
      if (
        child.id === parent.id ||
        hostFor(child) !== hostFor(parent) ||
        getWorktreeLineageRuntimeOwner(child) !== getWorktreeLineageRuntimeOwner(parent)
      ) {
        return false
      }
      const row = getWorktreeOnHostFromState(snapshot, child.id, child.hostId)
      const parentRow = getWorktreeOnHostFromState(snapshot, parent.id, parent.hostId)
      const lineage = row && getProjectedWorktreeLineage(row, snapshot.worktreeLineageById)
      return (
        isStrictWorktreeDescendantPath(parent.path, child.path) ||
        Boolean(
          row && parentRow && lineage && isValidResolvedWorktreeLineageEdge(row, parentRow, lineage)
        )
      )
    })
    dependencies.set(getWorktreeHostIdentity(parent), children)
  }
  return dependencies
}
