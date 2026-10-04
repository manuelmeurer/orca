import { describe, expect, it } from 'vitest'

import type { FolderWorkspace } from '../../shared/folder-workspaces/folder-workspace-types'
import type { WorkspaceStatus } from '../../shared/worktree/types'
import { mergeWorktree } from '../ipc/worktree-metadata-merge'
import type { RuntimeManagedWorktreeCreateArgs } from './workspaces/creation/runtime-managed-worktree-create-types'
import { withParentWorkspaceStatus } from './runtime-worktree-create-inherited-status'
import type { WorktreeLineageResolution } from './workspaces/lineage/runtime-worktree-lineage-resolution'
import type { ResolvedWorktree } from './workspaces/catalog/runtime-worktree-path-identity'

const request: RuntimeManagedWorktreeCreateArgs = { repoSelector: 'id:repo-1', name: 'child' }

function worktreeParent(workspaceStatus?: WorkspaceStatus): WorktreeLineageResolution {
  const git = {
    path: '/workspaces/parent',
    head: 'abc123',
    branch: 'refs/heads/parent',
    isBare: false,
    isMainWorktree: false
  }
  const worktree: ResolvedWorktree = {
    ...mergeWorktree('repo-1', git, {
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
      ...(workspaceStatus ? { workspaceStatus } : {})
    }),
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
  it('starts a child worktree in its parent worktree status', () => {
    expect(withParentWorkspaceStatus(request, worktreeParent('completed')).workspaceStatus).toBe(
      'completed'
    )
  })

  it('starts a child worktree in its parent folder status', () => {
    expect(withParentWorkspaceStatus(request, folderParent('in-review')).workspaceStatus).toBe(
      'in-review'
    )
  })

  it('keeps an explicitly requested status', () => {
    const explicit = { ...request, workspaceStatus: 'todo' }
    expect(withParentWorkspaceStatus(explicit, worktreeParent('completed')).workspaceStatus).toBe(
      'todo'
    )
  })

  it('leaves the status unset without a parent', () => {
    expect(
      withParentWorkspaceStatus(request, { kind: 'none', warnings: [] }).workspaceStatus
    ).toBeUndefined()
  })

  it('leaves the status unset when the parent folder has none', () => {
    expect(withParentWorkspaceStatus(request, folderParent()).workspaceStatus).toBeUndefined()
  })
})
