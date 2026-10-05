import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { isStrictWorktreeDescendantPath } from './worktree-delete-lineage-dependencies'
import type { Worktree } from '../../../../shared/worktree/types'

/** Runs one repo's deletes, children first; `group` must be sorted deepest path first. */
export async function runWorktreeDeleteGroup<T extends Pick<Worktree, 'path' | 'hostId'>>(
  group: readonly T[],
  run: (target: T) => Promise<void>
): Promise<void> {
  const started: { path: string; settled: Promise<void> }[] = []
  // Why only this machine's repos run in parallel: its host serializes the branch cleanup per
  // repo and limits concurrent deletes, while SSH and paired (possibly older) hosts race the
  // repo's ref locks when one repo deletes in parallel (#2259).
  const serialized = (group[0]?.hostId ?? LOCAL_EXECUTION_HOST_ID) !== LOCAL_EXECUTION_HOST_ID
  for (const target of group) {
    // A descendant's outcome decides whether its ancestor may be deleted at all.
    const descendants = started.filter((earlier) =>
      isStrictWorktreeDescendantPath(target.path, earlier.path)
    )
    if (descendants.length > 0) {
      await Promise.all(descendants.map((earlier) => earlier.settled))
    }
    const settled = run(target)
    started.push({ path: target.path, settled })
    if (serialized) {
      await settled
    }
  }
  await Promise.all(started.map((entry) => entry.settled))
}
