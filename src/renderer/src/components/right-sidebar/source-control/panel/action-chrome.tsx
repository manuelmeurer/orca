import type React from 'react'
import { createPortal } from 'react-dom'
import {
  SourceControlHeaderOverflowMenu,
  type SourceControlPanelActions
} from './header-overflow-menu'
import { useSourceControlHeaderActionsSlot } from './header-actions-slot'
import { useSourceControlScope } from './worktree-scope'

// Why: custom builds hide the PR and commit chrome above the file list (Create PR, filter,
// branch line, commit box); agents commit and open pull requests instead.
export const SOURCE_CONTROL_ACTION_CHROME_VISIBLE = false

/** The header without its PR, filter and branch chrome. Graph and the overflow menu stay where the
 *  full toolbar puts them (a folder card's header slot; else the file-list header, or the panel's
 *  top right without one), and a paused rebase/merge/cherry-pick keeps its operation row. */
export function SourceControlOverflowOnlyHeader({
  panelActions,
  operationRow,
  graphControl,
  toolsInFileListHeader
}: {
  panelActions: SourceControlPanelActions
  operationRow?: React.ReactNode
  graphControl?: React.ReactNode
  toolsInFileListHeader: boolean
}): React.JSX.Element | null {
  const embedded = useSourceControlScope() !== null
  const actionsSlot = useSourceControlHeaderActionsSlot()
  const menu = <SourceControlHeaderOverflowMenu panelActions={panelActions} />
  const operation = operationRow ? (
    <div className="flex min-w-0 flex-col border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
      {operationRow}
    </div>
  ) : null

  if (embedded) {
    return (
      <>
        {actionsSlot
          ? createPortal(
              <>
                {graphControl}
                {menu}
              </>,
              actionsSlot
            )
          : null}
        {operation}
      </>
    )
  }
  if (toolsInFileListHeader) {
    return operation
  }
  return (
    <>
      <div className="flex items-center justify-end gap-1 border-b border-border px-3 pt-1.5 pb-1">
        {graphControl}
        {menu}
      </div>
      {operation}
    </>
  )
}
