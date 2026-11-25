import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../../store/index'
import type { NativeChatComposerHandle } from '../composer/native-chat-composer-types'
import {
  formatNativeChatQuote,
  readNativeChatQuotableSelection
} from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import { readNativeChatTranscriptSelection } from './native-chat-transcript-selection'
import { SelectionAddToChatPopover } from './SelectionAddToChatPopover'

function copyTranscriptSelectionOnSelect(root: HTMLElement): void {
  if (!useAppStore.getState().settings?.terminalClipboardOnSelect) {
    return
  }
  const text = readNativeChatTranscriptSelection(root)
  if (text) {
    // Swallowed like the terminal's copy on select: a failed copy leaves the selection to retry.
    void window.api.ui.writeClipboardText(text).catch(() => {})
  }
}

/** A box a selection is quoted into: chat's composer, or an item's comment box. */
export type NativeChatQuoteTarget = Pick<
  NativeChatComposerHandle,
  'acceptsText' | 'appendText' | 'submit'
>

/** The quote target of a box built on chat's composer. */
export function composerQuoteTarget(
  composer: RefObject<NativeChatComposerHandle | null>
): NativeChatQuoteTarget {
  return {
    acceptsText: () => composer.current?.acceptsText() === true,
    appendText: (text, options) => composer.current?.appendText(text, options)
  }
}

export function NativeChatSelectionQuote({
  rootRef,
  composerRef,
  enabled
}: {
  rootRef: RefObject<HTMLElement | null>
  composerRef: RefObject<NativeChatQuoteTarget | null>
  enabled: boolean
}): React.JSX.Element {
  return (
    <SelectionAddToChatPopover
      rootRef={rootRef}
      enabled={enabled}
      readQuotable={(root) =>
        composerRef.current?.acceptsText() ? readNativeChatQuotableSelection(root) : null
      }
      onSelectionSettled={copyTranscriptSelectionOnSelect}
      onAdd={(text) => composerRef.current?.appendText(formatNativeChatQuote(text))}
      onReply={(text, reply) => {
        if (!composerRef.current?.submit) {
          return
        }
        // Rendered first: Send reads the draft the box last rendered, as Enter does.
        flushSync(() => composerRef.current?.appendText(`${formatNativeChatQuote(text)}${reply}`))
        // Read again: a box whose handle is rebuilt each render sends from the new one.
        composerRef.current?.submit?.()
      }}
    />
  )
}
