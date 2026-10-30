import {
  projectedStructuredChatTabName,
  type StructuredChatTabNames
} from '@/runtime/structured-chat-tab-name'
import { structuredChatTabById } from './structured-chat-tab-index'
import type { AgentType } from '../../../shared/agent-status-types'
import type { AppState } from '@/store/types'
import { isTerminalLeafId, makePaneKey } from '../../../shared/stable-pane-id'
import { resolveTerminalTitleAgentType } from '../../../shared/terminal-title-agent-type'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { TerminalAgent } from '../../../shared/terminal-agent'
import { detectAgentSendTitleStatus } from './agent-send-title-status'
import {
  resolveRuntimePaneTitleLeafResolution,
  type RuntimePaneTitleLeafResolution
} from '../../../shared/runtime-pane-title-leaf-id'
import {
  deriveRunningAgentSendTargets,
  deriveStatuslessStructuredAgentSendTargets,
  runningAgentMessageTarget,
  type RunningAgentSendTarget,
  type RunningAgentTargetState
} from './running-agent-targets'
import type { AgentMessageTarget } from './agent-message-target'

export type NotesSendAgentTargetState = RunningAgentTargetState &
  Pick<AppState, 'runtimePaneTitlesByTabId'>

export type NotesSendAgentTarget = {
  paneKey: string
  tabId: string
  leafId?: string
  messageTarget: AgentMessageTarget
  agentType: AgentType | null | undefined
  tabTitle: string
  status: 'eligible' | 'disabled'
  disabledReason?: string
}

const EMPTY_STRUCTURED_CHAT_TAB_NAMES: StructuredChatTabNames = new Map()

type AgentTitleEvidence = {
  status: NonNullable<ReturnType<typeof detectAgentSendTitleStatus>>
  title: string
}

function detectTitleHintPaneEvidence(
  paneTitleResolution: RuntimePaneTitleLeafResolution,
  tabTitle: string
): AgentTitleEvidence | null {
  if (paneTitleResolution.title !== null) {
    const status = detectAgentSendTitleStatus(paneTitleResolution.title)
    return status ? { status, title: paneTitleResolution.title } : null
  }
  // Use enriched tab title only before the leaf gets its own runtime title, as isTerminalRunningAgent does.
  if (paneTitleResolution.hasAnyPaneTitle) {
    return null
  }
  const status = detectAgentSendTitleStatus(tabTitle)
  return status ? { status, title: tabTitle } : null
}

/** Add live title-backed terminals and first-turn chats that lack hook status. launchAgent gives stronger ownership than manual title hints; hints expose targets only, while runtime independently verifies guarded writes. */
export function deriveNotesSendAgentTargets(
  state: NotesSendAgentTargetState,
  worktreeId: string,
  chatNames?: StructuredChatTabNames,
  now?: number
): NotesSendAgentTarget[]
export function deriveNotesSendAgentTargets(
  state: NotesSendAgentTargetState,
  worktreeId: string,
  now?: number
): NotesSendAgentTarget[]
export function deriveNotesSendAgentTargets(
  state: NotesSendAgentTargetState,
  worktreeId: string,
  chatNamesOrNow: StructuredChatTabNames | number = EMPTY_STRUCTURED_CHAT_TAB_NAMES,
  now = Date.now()
): NotesSendAgentTarget[] {
  const chatNames =
    typeof chatNamesOrNow === 'number' ? EMPTY_STRUCTURED_CHAT_TAB_NAMES : chatNamesOrNow
  const targetNow = typeof chatNamesOrNow === 'number' ? chatNamesOrNow : now
  const targets: NotesSendAgentTarget[] = [
    ...deriveRunningAgentSendTargets(state, worktreeId, targetNow),
    ...deriveStatuslessStructuredAgentSendTargets(state, worktreeId)
  ].map((target) => {
    const tab = structuredChatTabById(state.unifiedTabsByWorktree, worktreeId, target.tabId)
    const title =
      target.kind === 'structured-session' && tab?.entityId === target.sessionId
        ? projectedStructuredChatTabName(tab, chatNames)
        : undefined
    return toNotesSendAgentTarget(target, title)
  })

  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    const titleHintTarget = deriveTitleHintAgentTarget(state, tab)
    if (!titleHintTarget) {
      continue
    }

    // Launch ownership permits fresh titles to override stale same-pane status; manual hints may only add missing rows.
    if (tab.launchAgent) {
      mergeLaunchAgentTitleTarget(targets, titleHintTarget)
    } else {
      mergeManualAgentTitleTarget(targets, titleHintTarget)
    }
  }

  return targets
}

function toNotesSendAgentTarget(
  target: RunningAgentSendTarget,
  title?: string
): NotesSendAgentTarget {
  return {
    paneKey: target.paneKey,
    tabId: target.tabId,
    ...(target.kind === 'terminal' ? { leafId: target.leafId } : {}),
    messageTarget: runningAgentMessageTarget(target),
    agentType:
      target.kind === 'terminal'
        ? resolveNotesTargetAgentType(target.entry.agentType, target.tab.launchAgent)
        : target.agentType,
    tabTitle: target.kind === 'terminal' ? target.tab.title : (title ?? target.title),
    status: target.status,
    ...(target.disabledReason ? { disabledReason: target.disabledReason } : {})
  }
}

// Why: process-table identity outlives both hooks and titles; shellForeground
// proves the agent already exited, so it is the one disqualifying signal.
function resolveForegroundAgentProcess(
  state: NotesSendAgentTargetState,
  paneKey: string
): TerminalAgent | null {
  const foreground = state.paneForegroundAgentByPaneKey?.[paneKey]
  if (!foreground?.agent || foreground.shellForeground === true) {
    return null
  }
  return foreground.agent
}

function resolveNotesTargetAgentType(
  entryAgentType: AgentType | null | undefined,
  launchAgent: AgentType | null | undefined
): AgentType | null | undefined {
  if (entryAgentType && entryAgentType !== 'unknown') {
    return entryAgentType
  }
  return launchAgent ?? entryAgentType
}

function deriveTitleHintAgentTarget(
  state: NotesSendAgentTargetState,
  tab: TerminalTab
): NotesSendAgentTarget | null {
  const layout = state.terminalLayoutsByTabId[tab.id]
  const leafId = layout?.activeLeafId
  if (!leafId || !isTerminalLeafId(leafId)) {
    return null
  }

  const ptyId = layout.ptyIdsByLeafId?.[leafId] ?? null
  if (!ptyId || !state.ptyIdsByTabId[tab.id]?.includes(ptyId)) {
    return null
  }

  const paneTitles = state.runtimePaneTitlesByTabId[tab.id]
  const paneTitleResolution = resolveRuntimePaneTitleLeafResolution(layout, paneTitles, leafId)
  const paneKey = makePaneKey(tab.id, leafId)
  const titleEvidence = detectTitleHintPaneEvidence(paneTitleResolution, tab.title)
  if (!titleEvidence) {
    if (state.agentStatusByPaneKey[paneKey]?.restoredUnconfirmed) {
      return null
    }

    // Why: a hookless, title-silent agent is still provable by the pane's
    // foreground process, so fall back to it before dropping the pane.
    const foregroundAgent = resolveForegroundAgentProcess(state, paneKey)
    return foregroundAgent
      ? {
          paneKey,
          tabId: tab.id,
          leafId,
          messageTarget: { kind: 'terminal', tabId: tab.id, leafId },
          agentType: tab.launchAgent ?? foregroundAgent,
          tabTitle: tab.title,
          status: 'eligible'
        }
      : null
  }
  const disabledReason =
    titleEvidence.status === 'permission' ? 'Agent needs permission' : undefined

  return {
    paneKey,
    tabId: tab.id,
    leafId,
    messageTarget: { kind: 'terminal', tabId: tab.id, leafId },
    agentType: tab.launchAgent ?? resolveTerminalTitleAgentType(titleEvidence.title),
    tabTitle: tab.title,
    status: disabledReason ? 'disabled' : 'eligible',
    ...(disabledReason ? { disabledReason } : {})
  }
}

// Manual hints are weakest; never duplicate status/launch rows, including disabled ones.
function mergeManualAgentTitleTarget(
  targets: NotesSendAgentTarget[],
  target: NotesSendAgentTarget
): void {
  if (targets.some((existing) => existing.tabId === target.tabId)) {
    return
  }
  targets.push(target)
}

function mergeLaunchAgentTitleTarget(
  targets: NotesSendAgentTarget[],
  target: NotesSendAgentTarget
): void {
  const samePaneIndex = targets.findIndex((existing) => existing.paneKey === target.paneKey)
  if (samePaneIndex !== -1) {
    const existing = targets[samePaneIndex]
    if (existing.status === 'eligible' || existing.disabledReason === 'Agent needs permission') {
      return
    }

    // Sleep/resume can leave stale hook status; prefer fresh live-title evidence on the same launch-owned pane.
    targets[samePaneIndex] = {
      ...target,
      agentType:
        existing.agentType && existing.agentType !== 'unknown'
          ? existing.agentType
          : target.agentType,
      tabTitle: existing.tabTitle || target.tabTitle
    }
    return
  }

  // Deduplicate fresh/permission rows by tab or an active split shell could create a bogus second target.
  if (
    targets.some(
      (existing) =>
        existing.tabId === target.tabId &&
        (existing.status === 'eligible' || existing.disabledReason === 'Agent needs permission')
    )
  ) {
    return
  }

  targets.push(target)
}
