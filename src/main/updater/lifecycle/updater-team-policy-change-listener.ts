import { isCustomBuild } from '../../../shared/custom-update-policy'
import {
  managesUpdates,
  sameTeamUpdatePolicy,
  type TeamUpdatePolicy
} from '../releases/updater-release-policy'
import {
  sameTeamUpdateRestartScope,
  type TeamUpdateRestartScope
} from './team-update-restart-record'
import { TEAM_POLICY_CHECK_RETRY_MS } from './updater-state'

export function registerTeamUpdatePolicyChangeListener({
  appVersion,
  getPolicy,
  getScope,
  onChange,
  invalidateRestart,
  markTeamPolicyCheckPending,
  runBackgroundUpdateCheck,
  scheduleAutomaticUpdateCheck
}: {
  appVersion: string
  getPolicy: () => TeamUpdatePolicy | undefined
  getScope: () => TeamUpdateRestartScope | undefined
  onChange?: (listener: () => void) => void
  invalidateRestart: () => boolean
  markTeamPolicyCheckPending: () => void
  runBackgroundUpdateCheck: () => boolean
  scheduleAutomaticUpdateCheck: (delayMs: number) => void
}): TeamUpdatePolicy | undefined {
  let previousPolicy = getPolicy()
  let previousScope = getScope()
  if (isCustomBuild(appVersion)) {
    return previousPolicy
  }
  onChange?.(() => {
    const next = getPolicy()
    const nextScope = getScope()
    const checkNeeded =
      (managesUpdates(previousPolicy) || managesUpdates(next)) &&
      (!sameTeamUpdatePolicy(previousPolicy, next) ||
        !sameTeamUpdateRestartScope(previousScope, nextScope))
    previousPolicy = next
    previousScope = nextScope
    if (!checkNeeded || invalidateRestart()) {
      return
    }
    markTeamPolicyCheckPending()
    if (!runBackgroundUpdateCheck()) {
      scheduleAutomaticUpdateCheck(TEAM_POLICY_CHECK_RETRY_MS)
    }
  })
  return previousPolicy
}
