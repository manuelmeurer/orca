import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOURCE_CONTROL_ACTION_CHROME_VISIBLE } from './action-chrome'

const source = (file: string) => readFileSync(join(__dirname, file), 'utf8')

describe('Source Control action chrome', () => {
  it('is hidden', () => {
    expect(SOURCE_CONTROL_ACTION_CHROME_VISIBLE).toBe(false)
  })

  it('gates the header toolbar', () => {
    expect(source('panel-ready.tsx')).toMatch(
      /\{SOURCE_CONTROL_ACTION_CHROME_VISIBLE && \(\s*<SourceControlHeaderToolbar\b/
    )
  })

  it('gates the commit surface', () => {
    expect(source('panel-content.tsx')).toMatch(
      /\{SOURCE_CONTROL_ACTION_CHROME_VISIBLE &&\s*shouldRenderCommitArea\([^)]*\) && \(\s*<SourceControlCommitSurface\b/
    )
  })
})
