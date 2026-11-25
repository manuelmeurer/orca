import type { PluginMonacoTheme } from './plugin-monaco-theme'

type MonacoDiffColorsRoot = Pick<HTMLElement, 'dataset'>

const SIDES = [
  ['inserted', 'monacoThemeDiffInserted'],
  ['removed', 'monacoThemeDiffRemoved']
] as const

/** Whether the editor theme paints one side's diff backgrounds; without, Monaco keeps vs / vs-dark's. */
export function hasThemeDiffBackground(
  theme: PluginMonacoTheme | null,
  side: (typeof SIDES)[number][0]
): boolean {
  const colors = theme?.data.colors ?? {}
  return (
    Boolean(colors[`diffEditor.${side}LineBackground`]) ||
    Boolean(colors[`diffEditor.${side}TextBackground`])
  )
}

/** Marks the root per side while the editor theme paints that side's diff backgrounds; main.css
 *  fades only the built-in tints of the other side(s). */
export function paintMonacoDiffColors(
  theme: PluginMonacoTheme | null,
  root: MonacoDiffColorsRoot = document.documentElement
): void {
  for (const [side, key] of SIDES) {
    if (hasThemeDiffBackground(theme, side)) {
      root.dataset[key] = ''
    } else {
      delete root.dataset[key]
    }
  }
}
