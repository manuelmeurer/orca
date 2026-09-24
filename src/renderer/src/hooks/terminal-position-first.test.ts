import { describe, expect, it, vi } from 'vitest'
import { setupTerminalCreateSurfacing } from './ipc-events-terminal-create-test-harness'

describe('desktop terminal first placement', () => {
  it.each([undefined, 'codex'])(
    'places command %s before mixed tabs without changing focus',
    async (command) => {
      const scenario = await setupTerminalCreateSurfacing(() => false)
      const reorderUnifiedTabs = vi.fn()
      Object.assign(scenario.storeState, {
        groupsByWorktree: {
          'wt-1': [
            { id: 'other', tabOrder: ['untouched'] },
            { id: 'target', tabOrder: ['browser', 'editor', 'old-terminal', 'new-terminal'] }
          ]
        },
        unifiedTabsByWorktree: { 'wt-1': [{ id: 'new-terminal', entityId: 'tab-new' }] },
        reorderUnifiedTabs
      })
      const listener = scenario.requestTerminalCreateListenerRef.current
      if (!listener) {
        throw new Error('Missing terminal request listener')
      }
      listener({
        requestId: 'position-first',
        worktreeId: 'wt-1',
        command,
        position: 'first',
        activate: false
      })
      expect(reorderUnifiedTabs).toHaveBeenCalledExactlyOnceWith(
        'target',
        ['new-terminal', 'browser', 'editor', 'old-terminal'],
        { recordInteraction: false }
      )
      expect(scenario.setActiveTab).not.toHaveBeenCalled()
      expect(scenario.setActiveWorktree).not.toHaveBeenCalled()
      expect(scenario.replyTerminalCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 'tab-new' })
      )
    }
  )

  it('handles an empty group and keeps explicit focus', async () => {
    const scenario = await setupTerminalCreateSurfacing(() => false)
    const reorderUnifiedTabs = vi.fn()
    Object.assign(scenario.storeState, {
      groupsByWorktree: { 'wt-1': [{ id: 'target', tabOrder: ['new-terminal'] }] },
      unifiedTabsByWorktree: { 'wt-1': [{ id: 'new-terminal', entityId: 'tab-new' }] },
      reorderUnifiedTabs
    })
    scenario.requestTerminalCreateListenerRef.current?.({
      requestId: 'focused',
      worktreeId: 'wt-1',
      position: 'first',
      presentation: 'focused'
    })
    expect(reorderUnifiedTabs).toHaveBeenCalledWith('target', ['new-terminal'], {
      recordInteraction: false
    })
    expect(scenario.setActiveTab).toHaveBeenCalledWith('tab-new')
  })
})
