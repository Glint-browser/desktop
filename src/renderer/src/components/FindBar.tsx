import { useEffect, useRef, useState, type JSX } from 'react'
import { CaretDown, CaretUp, X } from '@phosphor-icons/react'
import type { FindResult } from '../../../shared/types'

interface Props {
  onClose: () => void
}

/** In-page find bar (⌘F). Sits above the page view so it stays visible. */
export function FindBar({ onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return window.browser.onFindResult(setResult)
  }, [])

  const close = (): void => {
    window.browser.stopFind()
    onClose()
  }

  const search = (text: string, forward = true): void => {
    setQuery(text)
    if (text) window.browser.find(text, forward)
    else {
      window.browser.stopFind()
      setResult(null)
    }
  }

  const count = query && result ? `${result.matches ? result.activeMatchOrdinal : 0}/${result.matches}` : ''

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="Find in page"
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'Enter') search(query, !e.shiftKey)
        }}
      />
      <span className="find-count">{count}</span>
      <button className="find-btn" title="Previous" onClick={() => search(query, false)}>
        <CaretUp size={15} weight="bold" />
      </button>
      <button className="find-btn" title="Next" onClick={() => search(query, true)}>
        <CaretDown size={15} weight="bold" />
      </button>
      <button className="find-btn" title="Close" onClick={close}>
        <X size={15} weight="bold" />
      </button>
    </div>
  )
}
