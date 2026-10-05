import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const diffViewer = readFileSync(join(__dirname, 'DiffViewer.tsx'), 'utf8')

describe('Diff editor overview markers', () => {
  it('keeps the green/red diff overview', () => {
    expect(diffViewer).toMatch(/renderOverviewRuler: true/)
  })

  it('hides the inner editor overview ruler beside it', () => {
    expect(diffViewer).toMatch(/overviewRulerLanes: 0/)
  })
})
