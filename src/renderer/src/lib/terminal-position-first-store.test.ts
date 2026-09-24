import { beforeEach, expect, it } from 'vitest'
import { useAppStore } from '../store'
import { insertUnifiedTabFirst } from './unified-tab-anchor-insertion'
import type { Tab } from '../../../shared/tab-types'

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))

it('persists canonical and sort order, retaining group membership and active tab', () => {
  const tabs: Tab[] = ['editor', 'browser', 'new', 'other'].map((id, sortOrder) => ({
    id,
    entityId: id,
    worktreeId: 'folder:test',
    groupId: id === 'other' ? 'other-group' : 'group',
    contentType: id === 'editor' ? 'editor' : id === 'browser' ? 'browser' : 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder,
    createdAt: 0
  }))
  useAppStore.setState({
    unifiedTabsByWorktree: { 'folder:test': tabs },
    groupsByWorktree: {
      'folder:test': [
        {
          id: 'group',
          worktreeId: 'folder:test',
          activeTabId: 'editor',
          tabOrder: ['editor', 'browser', 'new']
        },
        { id: 'other-group', worktreeId: 'folder:test', activeTabId: 'other', tabOrder: ['other'] }
      ]
    }
  })
  insertUnifiedTabFirst('folder:test', 'new')
  insertUnifiedTabFirst('folder:test', 'new')
  const state = useAppStore.getState()
  expect(state.groupsByWorktree['folder:test'][0]).toMatchObject({
    activeTabId: 'editor',
    tabOrder: ['new', 'editor', 'browser']
  })
  expect(state.groupsByWorktree['folder:test'][1].tabOrder).toEqual(['other'])
  expect(
    state.unifiedTabsByWorktree['folder:test']
      .filter((tab) => tab.groupId === 'group')
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((tab) => tab.id)
  ).toEqual(['new', 'editor', 'browser'])
})
