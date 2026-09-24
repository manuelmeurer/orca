import { useAppStore } from '../store'

export function insertUnifiedTabFirst(worktreeId: string, tabId: string): void {
  const state = useAppStore.getState()
  const group = (state.groupsByWorktree[worktreeId] ?? []).find((candidate) =>
    candidate.tabOrder.includes(tabId)
  )
  if (!group) {
    throw new Error('Cannot position terminal: its tab group is unavailable')
  }
  state.reorderUnifiedTabs(group.id, [tabId, ...group.tabOrder.filter((id) => id !== tabId)], {
    recordInteraction: false
  })
}

/** Move `tabId` to sit immediately after `anchorTabId`; no-op unless both share a group. */
export function insertUnifiedTabAfterAnchor(
  worktreeId: string,
  tabId: string,
  anchorTabId: string
): void {
  if (tabId === anchorTabId) {
    return
  }
  const state = useAppStore.getState()
  const group = (state.groupsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.tabOrder.includes(tabId) && candidate.tabOrder.includes(anchorTabId)
  )
  if (!group) {
    return
  }
  const order = group.tabOrder.filter((id) => id !== tabId)
  order.splice(order.indexOf(anchorTabId) + 1, 0, tabId)
  state.reorderUnifiedTabs(group.id, order, { recordInteraction: false })
}
