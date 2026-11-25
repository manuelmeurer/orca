import type React from 'react'
import { createPortal } from 'react-dom'
import { SourceControlHeaderOverflowMenu } from './header-overflow-menu'
import { useSourceControlHeaderActionsSlot } from './header-actions-slot'
import { useSourceControlScope } from './worktree-scope'

// Why: custom builds hide the PR and commit chrome above the file list (Create PR, filter,
// branch line, commit box); agents commit and open pull requests instead.
export const SOURCE_CONTROL_ACTION_CHROME_VISIBLE = false

type OverflowActions = React.ComponentProps<typeof SourceControlHeaderOverflowMenu>['panelActions']

/** The header without its PR, filter and branch chrome: only the overflow menu, where the full
 *  toolbar puts it (a folder card's header slot, else the panel's top right). */
export function SourceControlOverflowOnlyHeader({
  panelActions
}: {
  panelActions: NonNullable<OverflowActions>
}): React.JSX.Element | null {
  const embedded = useSourceControlScope() !== null
  const actionsSlot = useSourceControlHeaderActionsSlot()
  const menu = <SourceControlHeaderOverflowMenu panelActions={panelActions} />
  if (embedded) {
    return actionsSlot ? createPortal(menu, actionsSlot) : null
  }
  return (
    <div className="flex items-center justify-end border-b border-border px-3 pt-1.5 pb-1">
      {menu}
    </div>
  )
}
