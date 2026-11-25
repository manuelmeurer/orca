// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  SOURCE_CONTROL_ACTION_CHROME_VISIBLE,
  SourceControlOverflowOnlyHeader
} from './action-chrome'

const source = (file: string) => readFileSync(join(__dirname, file), 'utf8')

afterEach(cleanup)

describe('Source Control action chrome', () => {
  it('is hidden', () => {
    expect(SOURCE_CONTROL_ACTION_CHROME_VISIBLE).toBe(false)
  })

  it('swaps the header toolbar for the overflow menu alone', () => {
    expect(source('panel-ready.tsx')).toMatch(
      /\{SOURCE_CONTROL_ACTION_CHROME_VISIBLE \? \(\s*<SourceControlHeaderToolbar\b[\s\S]*?\/>\s*\) : \(\s*<SourceControlOverflowOnlyHeader\b/
    )
  })

  it('gates the commit surface', () => {
    expect(source('panel-content.tsx')).toMatch(
      /const commitSurfaceShown =\s*SOURCE_CONTROL_ACTION_CHROME_VISIBLE &&/
    )
  })

  it('hides the file filter in the file-list header', () => {
    expect(source('panel-ready.tsx')).toMatch(
      /filter=\{embedded \|\| !SOURCE_CONTROL_ACTION_CHROME_VISIBLE \? null : filter\}/
    )
  })

  it('keeps the overflow menu without Create PR, filter or branch line', async () => {
    const onToggleViewMode = vi.fn()
    const onChangeBaseRef = vi.fn()
    render(
      <TooltipProvider>
        <SourceControlOverflowOnlyHeader
          panelActions={{
            sourceControlViewMode: 'list',
            viewModeToggleDisabled: false,
            onToggleViewMode,
            onChangeBaseRef,
            onRefreshBranchCompare: vi.fn(),
            branchCompareRefreshDisabled: false,
            diffCommentCount: 2,
            onExpandNotes: vi.fn(),
            gitGraphDisabled: true
          }}
          toolsInFileListHeader={false}
        />
      </TooltipProvider>
    )
    expect(screen.queryByTestId('source-control-filter-toggle')).toBeNull()
    expect(screen.queryByRole('button', { name: /create pr/i })).toBeNull()
    const more = screen.getByRole('button', { name: 'More source control actions' })
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitem', { name: 'View as tree' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Change Base Ref/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Notes/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'View as tree' }))
    expect(onToggleViewMode).toHaveBeenCalledOnce()
  })
})
