import { describe, expect, it, vi } from 'vitest'
import type {
  AgentLaunchResult,
  AgentLaunchTarget
} from '../../../../../shared/agent-launch/contracts/agent-launch-intent'
import {
  AgentLaunch,
  type AgentLaunchParams
} from '../../../../../shared/rpc-contract/agent-launch/agent-launch-params'
import type { RpcCallerIdentity } from '../../callers/rpc-caller-identity'
import type { RpcContext } from '../../core'
import { launchAgentOnHost } from './agent-launch'
import { presentAgentLaunchSurface } from './agent-launch-caller-selection'

const executeAgentLaunchMock = vi.hoisted(() => vi.fn())
const resolveUnlaunchedIntentMock = vi.hoisted(() => vi.fn())
vi.mock('../../../../agent-launch/agent-launch-executor', () => ({
  executeAgentLaunch: executeAgentLaunchMock
}))
vi.mock('./agent-launch-intent-resolution', () => ({
  resolveUnlaunchedIntent: resolveUnlaunchedIntentMock
}))
vi.mock('./agent-launch-surfaces', () => ({ agentLaunchSurfaceFactory: vi.fn(() => ({})) }))
vi.mock('./agent-launch-worktree-creation', () => ({
  agentLaunchWorkspaceFactory: vi.fn(() => ({}))
}))

const EXISTING_TARGET: AgentLaunchTarget = { kind: 'existing', worktree: 'id:wt-7' }

const STRUCTURED_SURFACE: AgentLaunchResult = {
  outcome: { kind: 'structured', sessionId: 'sess-1', handle: 'session-1' },
  worktreeId: 'wt-7',
  receipt: {
    mode: 'structured',
    preferred: 'structured',
    reason: 'user_default',
    detail: 'The launch opened a chat.'
  }
}

const TERMINAL_SURFACE: AgentLaunchResult = {
  outcome: { kind: 'terminal', handle: 'terminal-1' },
  worktreeId: 'wt-7',
  receipt: {
    mode: 'terminal',
    preferred: 'terminal',
    reason: 'user_default',
    detail: 'The launch opened a terminal.'
  }
}

function launchContext(caller: RpcCallerIdentity = { kind: 'local-cli' }) {
  const focusAgentLaunchChatInHostWindow = vi.fn()
  const selectCreatedMobileSessionTabForClient = vi.fn(async () => true)
  const runtime = {
    focusAgentLaunchChatInHostWindow,
    selectCreatedMobileSessionTabForClient
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this launch path only calls the two runtime methods stubbed here.
  const context = {
    runtime,
    caller,
    clientKind: caller?.kind === 'paired-device' ? 'mobile' : undefined
  } as unknown as RpcContext
  return { context, focusAgentLaunchChatInHostWindow, selectCreatedMobileSessionTabForClient }
}

describe('focused CLI chat launch presentation', () => {
  it('has the window select the chat and show its existing workspace', async () => {
    resolveUnlaunchedIntentMock.mockImplementation(async (params: AgentLaunchParams) => ({
      intent: params,
      decidedMode: {}
    }))
    executeAgentLaunchMock.mockImplementation(
      async (input: { onSurfacePublished: (surface: AgentLaunchResult) => Promise<void> }) => {
        await input.onSurfacePublished(STRUCTURED_SURFACE)
        return STRUCTURED_SURFACE
      }
    )
    const { context, focusAgentLaunchChatInHostWindow } = launchContext()

    await launchAgentOnHost(
      AgentLaunch.parse({
        agent: 'claude',
        target: EXISTING_TARGET,
        presentation: 'focused'
      }),
      context
    )

    expect(focusAgentLaunchChatInHostWindow).toHaveBeenCalledExactlyOnceWith({
      worktreeId: 'wt-7',
      sessionId: 'sess-1',
      revealWorkspace: true
    })
  })

  it('leaves showing a created worktree to its activation', async () => {
    const { context, focusAgentLaunchChatInHostWindow } = launchContext()

    await presentAgentLaunchSurface(context, STRUCTURED_SURFACE, 'focused', {
      kind: 'create-worktree',
      create: {}
    })

    expect(focusAgentLaunchChatInHostWindow).toHaveBeenCalledExactlyOnceWith({
      worktreeId: 'wt-7',
      sessionId: 'sess-1',
      revealWorkspace: false
    })
  })

  it('shows a created folder workspace, which has no activation of its own', async () => {
    const { context, focusAgentLaunchChatInHostWindow } = launchContext()

    await presentAgentLaunchSurface(context, STRUCTURED_SURFACE, 'focused', {
      kind: 'create-folder-workspace',
      create: {}
    })

    expect(focusAgentLaunchChatInHostWindow).toHaveBeenCalledExactlyOnceWith({
      worktreeId: 'wt-7',
      sessionId: 'sess-1',
      revealWorkspace: true
    })
  })

  it.each([
    ['a background chat', STRUCTURED_SURFACE, 'background'],
    ['a focused terminal', TERMINAL_SURFACE, 'focused']
  ] as const)('leaves %s to its own presentation', async (_name, surface, presentation) => {
    const { context, focusAgentLaunchChatInHostWindow } = launchContext()

    await presentAgentLaunchSurface(context, surface, presentation, EXISTING_TARGET)

    expect(focusAgentLaunchChatInHostWindow).not.toHaveBeenCalled()
  })

  it('keeps a paired device on its chat for a created worktree', async () => {
    const { context, focusAgentLaunchChatInHostWindow, selectCreatedMobileSessionTabForClient } =
      launchContext({ kind: 'paired-device', deviceId: 'device-1' })

    await presentAgentLaunchSurface(context, STRUCTURED_SURFACE, 'focused', {
      kind: 'create-worktree',
      create: {}
    })

    expect(selectCreatedMobileSessionTabForClient).toHaveBeenCalledExactlyOnceWith(
      'wt-7',
      { sessionId: 'sess-1' },
      'device-1'
    )
    expect(focusAgentLaunchChatInHostWindow).not.toHaveBeenCalled()
  })
})
