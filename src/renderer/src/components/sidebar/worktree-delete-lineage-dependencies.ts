import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { getWorktreeLineageRuntimeOwner } from '../../../../shared/resolved-worktree-lineage'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../../shared/worktree/types'

type WorktreeDeleteLineageTarget = Pick<
  Worktree,
  'id' | 'path' | 'hostId' | 'runtimeOwnerEnvironmentId'
>

function isStrictDescendantPath(parentPath: string, childPath: string): boolean {
  return (
    normalizeRuntimePathForComparison(parentPath) !==
      normalizeRuntimePathForComparison(childPath) && isPathInsideOrEqual(parentPath, childPath)
  )
}

export function buildWorktreeDeleteLineageDependencies<Target extends WorktreeDeleteLineageTarget>(
  targets: readonly Target[],
  hostFor: (target: Target) => ExecutionHostId | undefined,
  hasLineageEdge: (child: Target, parent: Target) => boolean
): Map<string, Target[]> {
  const dependencies = new Map<string, Target[]>()
  for (const parent of targets) {
    dependencies.set(
      getWorktreeHostIdentity(parent),
      targets.filter((child) => {
        if (
          child.id === parent.id ||
          hostFor(child) !== hostFor(parent) ||
          getWorktreeLineageRuntimeOwner(child) !== getWorktreeLineageRuntimeOwner(parent)
        ) {
          return false
        }
        return isStrictDescendantPath(parent.path, child.path) || hasLineageEdge(child, parent)
      })
    )
  }
  return dependencies
}
