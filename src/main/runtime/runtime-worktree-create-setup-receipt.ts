import type { CreateWorktreeResult, SetupDecision } from '../../shared/worktree/create-types'

export function buildRuntimeWorktreeSetupReceipt(
  enabled: boolean | undefined,
  input: {
    effectiveDecision: SetupDecision
    hookFound: boolean
    shouldRunSetup: boolean
    didSpawnSetup: boolean
    didStartInProcessSetupHook: boolean
    waitForAgentStartup?: boolean
    terminalHandle?: string
  }
): CreateWorktreeResult['setupReceipt'] {
  if (!enabled) {
    return undefined
  }
  return {
    requested: input.effectiveDecision,
    hookFound: input.hookFound,
    startupPolicy: input.waitForAgentStartup ? 'wait-for-setup' : 'start-immediately',
    state: !input.hookFound
      ? 'not_configured'
      : input.effectiveDecision === 'skip' || !input.shouldRunSetup
        ? 'skipped'
        : input.didSpawnSetup || input.didStartInProcessSetupHook
          ? 'running'
          : 'spawn_failed',
    ...(input.terminalHandle ? { terminalHandle: input.terminalHandle } : {})
  }
}
