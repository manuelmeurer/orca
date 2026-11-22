import { readAppRuntimeStatuses } from '@/store/slices/runtime-status/views/app-runtime-status-binding'
import type { AppState } from '@/store/types'
import type {
  AgentStatusEntry,
  AgentType
} from '../../../../../shared/agent-status/contracts/agent-status-types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  isAgentStatusFresh
} from '../../../../../shared/agent-status/contracts/agent-status-freshness'
import type { TerminalTab } from '../../../../../shared/workspace-layout/terminal-tab-types'
import { isRemoteRuntimePtyId } from '../../../../../shared/remote-runtime/remote-runtime-pty-id'
import { isRemoteExecutionHostPtyId } from '../../../../../shared/execution-host/remote-execution-host-pty-id'
import { makePaneKey, parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { structuredAgentSessionPaneKey } from '../../../../../shared/agent-session/view/structured-agent-session-projection'
import { isStructuredTab } from '../../../../../shared/agent-session/view/structured-agent-session-tab'
import type { AgentMessageTarget } from './agent-message-target'
import { detectAgentSendTitleStatus } from './agent-send-title-status'
import { resolveRuntimePaneTitleLeafResolution } from '../../../../../shared/workspace-layout/terminal-topology/runtime-pane-title-leaf-id'
import { hookSilentPaneSendState } from '../../../../../shared/agent-status/approval/hook-silent-approval-agents'
import { resolveTerminalTitleAgentType } from '../../../../../shared/agent-status/title/terminal-title-agent-type'
import {
  ptyHostGuardsSendApprovals,
  selectSendApprovalGuardEnvironmentIds
} from '@/runtime/hosts/capabilities/send-approval-guard-hosts'

export type RunningAgentTargetState = Pick<
  AppState,
  | 'agentStatusByPaneKey'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'ptyIdsByTabId'
> &
  Partial<Pick<AppState, 'runtimePaneTitlesByTabId' | 'paneForegroundAgentByPaneKey'>> & {
    /** Selected instead of the whole host-status map so unrelated host updates don't rescan targets;
     *  absent, the host status owner's current map decides. */
    sendApprovalGuardEnvironmentIds?: ReadonlySet<string>
  }

export type RunningAgentStatusEntries =
  | Pick<ReadonlyMap<string, AgentStatusEntry>, 'entries' | 'get'>
  | Record<string, AgentStatusEntry>

type RunningAgentSendTargetEligibility = {
  status: 'eligible' | 'disabled'
  disabledReason?: string
}

export type TerminalAgentSendTarget = RunningAgentSendTargetEligibility & {
  kind: 'terminal'
  paneKey: string
  tabId: string
  leafId: string
  tab: TerminalTab
  entry: AgentStatusEntry
  ptyId: string | null
}

export type StructuredAgentSendTarget = RunningAgentSendTargetEligibility & {
  kind: 'structured-session'
  paneKey: string
  /** The chat's workspace tab; it never appears in `tabsByWorktree`. */
  tabId: string
  sessionId: string
  agentType: AgentType
  title: string
  /** Null before the chat's first turn (the host publishes no status before one); only the
   *  notes menu lists such chats, as the sidebar has no row for them. */
  entry: AgentStatusEntry | null
}

export type RunningAgentSendTarget = TerminalAgentSendTarget | StructuredAgentSendTarget

export function runningAgentMessageTarget(target: RunningAgentSendTarget): AgentMessageTarget {
  return target.kind === 'terminal'
    ? { kind: 'terminal', tabId: target.tabId, leafId: target.leafId }
    : { kind: 'structured-session', sessionId: target.sessionId }
}

export function runningAgentSendTargetAgentType(
  target: RunningAgentSendTarget
): AgentType | null | undefined {
  return target.kind === 'terminal' ? target.entry.agentType : target.agentType
}

export function deriveRunningAgentSendTargets(
  state: RunningAgentTargetState,
  worktreeId: string,
  now = Date.now()
): RunningAgentSendTarget[] {
  return [
    ...deriveTerminalAgentSendTargets(state, worktreeId, now),
    ...deriveStructuredAgentSendTargets(state, worktreeId, 'with-status')
  ]
}

/** Chats of the worktree that have not had their first turn yet, so no status entry exists. */
export function deriveStatuslessStructuredAgentSendTargets(
  state: RunningAgentTargetState,
  worktreeId: string
): StructuredAgentSendTarget[] {
  return deriveStructuredAgentSendTargets(state, worktreeId, 'without-status')
}

function deriveTerminalAgentSendTargets(
  state: RunningAgentTargetState,
  worktreeId: string,
  now: number
): TerminalAgentSendTarget[] {
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  if (tabs.length === 0) {
    return []
  }

  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
  const targets: TerminalAgentSendTarget[] = []

  for (const [paneKey, entry] of getAgentStatusEntries(state.agentStatusByPaneKey)) {
    const parsed = parsePaneKey(paneKey)
    if (!parsed) {
      continue
    }
    const tab = tabsById.get(parsed.tabId)
    if (!tab) {
      continue
    }

    const layoutPtyId =
      state.terminalLayoutsByTabId?.[parsed.tabId]?.ptyIdsByLeafId?.[parsed.leafId] ?? null
    const ptyId =
      layoutPtyId && state.ptyIdsByTabId?.[parsed.tabId]?.includes(layoutPtyId) ? layoutPtyId : null
    let disabledReason: string | undefined

    const liveTitle = ptyId ? resolveLeafTitle(state, parsed.tabId, parsed.leafId, tab.title) : null
    const liveTitleStatus = liveTitle === null ? null : detectAgentSendTitleStatus(liveTitle)
    const liveForegroundAgent = resolveSendTargetForegroundAgent(state, paneKey, ptyId) !== null
    if (!ptyId) {
      disabledReason = 'Terminal is no longer available'
    } else if (
      entry.state === 'blocked' ||
      entry.state === 'waiting' ||
      liveTitleStatus === 'permission'
    ) {
      disabledReason = 'Agent needs permission'
    } else if (
      entry.restoredUnconfirmed ||
      (!isAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS) &&
        liveTitleStatus === null &&
        !liveForegroundAgent)
    ) {
      disabledReason = 'Agent status is stale'
    } else {
      disabledReason = hookSilentAgentSendRefusal(state, tab, ptyId, entry, paneKey, liveTitle)
    }

    targets.push({
      kind: 'terminal',
      paneKey,
      tabId: parsed.tabId,
      leafId: parsed.leafId,
      tab,
      entry,
      ptyId,
      status: disabledReason ? 'disabled' : 'eligible',
      ...(disabledReason ? { disabledReason } : {})
    })
  }

  return targets
}

// Chats have workspace tabs without PTYs; list only those with status because sidebar reveal/visibility/pills require a row. Notes separately exposes first-turn chats.
function deriveStructuredAgentSendTargets(
  state: RunningAgentTargetState,
  worktreeId: string,
  status: 'with-status' | 'without-status'
): StructuredAgentSendTarget[] {
  const targets: StructuredAgentSendTarget[] = []
  for (const tab of state.unifiedTabsByWorktree?.[worktreeId] ?? []) {
    if (!isStructuredTab(tab) || !tab.agentSessionAgent) {
      continue
    }
    const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
    const entry = getRunningAgentStatusEntry(state.agentStatusByPaneKey, paneKey) ?? null
    if ((entry !== null) !== (status === 'with-status')) {
      continue
    }
    const disabledReason =
      entry?.state === 'blocked' || entry?.state === 'waiting'
        ? 'Agent needs permission'
        : undefined
    targets.push({
      kind: 'structured-session',
      paneKey,
      tabId: tab.id,
      sessionId: tab.entityId,
      agentType: tab.agentSessionAgent,
      title: tab.customLabel?.trim() || tab.label,
      entry,
      status: disabledReason ? 'disabled' : 'eligible',
      ...(disabledReason ? { disabledReason } : {})
    })
  }
  return targets
}

// The tab title is the active surface's; it belongs to this leaf only when the tab has no split.
function resolveLeafTitle(
  state: RunningAgentTargetState,
  tabId: string,
  leafId: string,
  tabTitle: string
): string | null {
  const layout = state.terminalLayoutsByTabId[tabId]
  const paneTitles = state.runtimePaneTitlesByTabId?.[tabId]
  const paneTitleResolution = resolveRuntimePaneTitleLeafResolution(layout, paneTitles, leafId)
  const tabTitleIsLeafs =
    !paneTitleResolution.hasAnyPaneTitle && (!layout?.root || layout.root.type === 'leaf')
  return paneTitleResolution.title ?? (tabTitleIsLeafs ? tabTitle : null)
}

/** launchAgent names the tab's original PTY locally; a paired tab's ptyId follows its active pane, so any pane may be the launched one. */
export function launchAgentMayOwnPane(tab: Pick<TerminalTab, 'ptyId'>, ptyId: string): boolean {
  return ptyId === tab.ptyId || isRemoteRuntimePtyId(ptyId)
}

/** Why a pane that may run an agent whose hooks report working through approval menus can't take a paste and Enter now. */
export function hookSilentAgentSendRefusal(
  state: RunningAgentTargetState,
  tab: Pick<TerminalTab, 'ptyId' | 'launchAgent'>,
  ptyId: string,
  entry: Pick<AgentStatusEntry, 'state' | 'agentType'> | null | undefined,
  paneKey: string,
  leafTitle: string | null
): string | undefined {
  // Every identity counts: a row another agent left behind can't vouch for the one running now.
  const sendState = hookSilentPaneSendState(entry, [
    launchAgentMayOwnPane(tab, ptyId) ? tab.launchAgent : null,
    leafTitle === null ? null : resolveTerminalTitleAgentType(leafTitle),
    leafTitle === null ? resolveSendTargetForegroundAgent(state, paneKey, ptyId) : null
  ])
  if (sendState === 'none') {
    return undefined
  }
  const guardedHosts =
    state.sendApprovalGuardEnvironmentIds ??
    selectSendApprovalGuardEnvironmentIds(readAppRuntimeStatuses())
  if (!ptyHostGuardsSendApprovals(guardedHosts, ptyId)) {
    return 'Update Orca on this host to send to this agent'
  }
  return sendState === 'unproven' ? 'Agent may be waiting for approval' : undefined
}

export function resolveSendTargetForegroundAgent(
  state: RunningAgentTargetState,
  paneKey: string,
  ptyId: string | null
): AgentType | null {
  if (!ptyId || isRemoteExecutionHostPtyId(ptyId)) {
    return null
  }
  const foreground = state.paneForegroundAgentByPaneKey?.[paneKey]
  if (
    !foreground?.agent ||
    foreground.agentEvidence === 'launch-record' ||
    foreground.shellForeground === true
  ) {
    return null
  }
  return foreground.agent
}

function getAgentStatusEntries(
  statuses: RunningAgentStatusEntries
): Iterable<[string, AgentStatusEntry]> {
  if (typeof statuses.entries === 'function') {
    return statuses.entries()
  }
  return Object.entries(statuses)
}

export function getRunningAgentStatusEntry(
  statuses: RunningAgentStatusEntries,
  paneKey: string
): AgentStatusEntry | undefined {
  return typeof statuses.get === 'function' ? statuses.get(paneKey) : statuses[paneKey]
}

/** The pane's refusal for a send that bypasses the target list, such as the focused terminal. */
export function terminalPaneSendRefusal(
  state: RunningAgentTargetState,
  worktreeId: string,
  tabId: string,
  leafId: string
): string | undefined {
  const tab = state.tabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
  // A leaf whose binding hasn't arrived yet is checked against the tab's PTY rather than skipped.
  const ptyId = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId] ?? tab?.ptyId
  if (!tab || !ptyId) {
    return undefined
  }
  return hookSilentAgentSendRefusal(
    state,
    tab,
    ptyId,
    getRunningAgentStatusEntry(state.agentStatusByPaneKey, makePaneKey(tabId, leafId)),
    makePaneKey(tabId, leafId),
    resolveLeafTitle(state, tabId, leafId, tab.title)
  )
}

export function resolveRunningAgentSendTarget(
  state: RunningAgentTargetState,
  worktreeId: string,
  paneKey: string,
  now = Date.now()
): RunningAgentSendTarget | null {
  return (
    deriveRunningAgentSendTargets(state, worktreeId, now).find((t) => t.paneKey === paneKey) ?? null
  )
}
