import { describe, expect, it } from 'vitest'

import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { WorkspaceStatus } from '../../shared/worktree/types'
import { mergeWorktree } from '../ipc/worktree-metadata-merge'
import type { RuntimeManagedWorktreeCreateArgs } from './workspaces/creation/runtime-managed-worktree-create-types'
import {
  withParentWorkspaceStatus,
  type ParentWorkspaceStatusStore
} from './runtime-worktree-create-inherited-status'
import type { WorktreeLineageResolution } from './workspaces/lineage/runtime-worktree-lineage-resolution'
import type { ResolvedWorktree } from './workspaces/catalog/runtime-worktree-path-identity'

const request: RuntimeManagedWorktreeCreateArgs = { repoSelector: 'id:repo-1', name: 'child' }
const PARENT_ID = 'repo-1::/workspaces/parent'

function makeMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    displayName: 'parent',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function makeStore(
  meta: Record<string, WorktreeMeta> = {},
  metaForHost: Record<string, WorktreeMeta> = {}
): ParentWorkspaceStatusStore {
  return {
    getRepo: () => undefined,
    getWorktreeMeta: (worktreeId) => meta[worktreeId],
    getWorktreeMetaForHost: (worktreeId, hostId) => metaForHost[`${hostId}|${worktreeId}`]
  }
}

// The resolved parent can be stale because workspace status edits do not invalidate its snapshot.
function worktreeParent(snapshotStatus?: WorkspaceStatus): WorktreeLineageResolution {
  const git = {
    path: '/workspaces/parent',
    head: 'abc123',
    branch: 'refs/heads/parent',
    isBare: false,
    isMainWorktree: false
  }
  const worktree: ResolvedWorktree = {
    ...mergeWorktree(
      'repo-1',
      git,
      makeMeta(snapshotStatus ? { workspaceStatus: snapshotStatus } : {})
    ),
    parentWorktreeId: null,
    childWorktreeIds: [],
    lineage: null,
    git
  }
  return {
    kind: 'lineage',
    parent: {
      type: 'worktree',
      workspaceKey: `worktree:${worktree.id}`,
      worktree,
      instanceId: null
    },
    origin: 'cli',
    capture: { source: 'cwd-context', confidence: 'inferred' }
  }
}

function folderParent(workspaceStatus?: WorkspaceStatus): WorktreeLineageResolution {
  const folderWorkspace: FolderWorkspace = {
    id: 'folder-1',
    projectGroupId: 'group-1',
    name: 'Docs',
    folderPath: '/folders/docs',
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...(workspaceStatus ? { workspaceStatus } : {})
  }
  return {
    kind: 'lineage',
    parent: {
      type: 'folder',
      workspaceKey: 'folder:folder-1',
      folderWorkspace,
      instanceId: null
    },
    origin: 'cli',
    capture: { source: 'explicit-cli-flag', confidence: 'explicit' }
  }
}

describe('withParentWorkspaceStatus', () => {
  it('reads the parent worktree status from persisted metadata, not its resolved snapshot', () => {
    const store = makeStore({ [PARENT_ID]: makeMeta({ workspaceStatus: 'completed' }) })
    expect(
      withParentWorkspaceStatus(request, worktreeParent('in-progress'), store).workspaceStatus
    ).toBe('completed')
  })

  it('prefers the parent row owned by its execution host', () => {
    const store = makeStore(
      { [PARENT_ID]: makeMeta({ workspaceStatus: 'todo' }) },
      { [`local|${PARENT_ID}`]: makeMeta({ workspaceStatus: 'in-review' }) }
    )
    expect(
      withParentWorkspaceStatus(request, worktreeParent('in-progress'), store).workspaceStatus
    ).toBe('in-review')
  })

  it('ignores a same-id row owned by another host', () => {
    const store = makeStore({
      [PARENT_ID]: makeMeta({ hostId: 'ssh:other', workspaceStatus: 'todo' })
    })
    expect(
      withParentWorkspaceStatus(request, worktreeParent('in-review'), store).workspaceStatus
    ).toBe('in-review')
  })

  it('starts a child worktree in its parent folder status', () => {
    expect(
      withParentWorkspaceStatus(request, folderParent('in-review'), makeStore()).workspaceStatus
    ).toBe('in-review')
  })

  it('keeps an explicitly requested status', () => {
    const explicit = { ...request, workspaceStatus: 'todo' }
    const store = makeStore({ [PARENT_ID]: makeMeta({ workspaceStatus: 'completed' }) })
    expect(
      withParentWorkspaceStatus(explicit, worktreeParent('completed'), store).workspaceStatus
    ).toBe('todo')
  })

  it('leaves the status unset without a parent', () => {
    expect(
      withParentWorkspaceStatus(request, { kind: 'none', warnings: [] }, makeStore())
        .workspaceStatus
    ).toBeUndefined()
  })

  it('leaves the status unset when the parent folder has none', () => {
    expect(
      withParentWorkspaceStatus(request, folderParent(), makeStore()).workspaceStatus
    ).toBeUndefined()
  })
})
