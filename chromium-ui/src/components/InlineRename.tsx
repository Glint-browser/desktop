import { useEffect, useRef, useState, type JSX } from 'react'

/** Inline text editor used for renaming a space or folder. */
export function InlineRename({
  initial,
  onSubmit,
  onCancel
}: {
  initial: string
  onSubmit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="inline-rename"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') value.trim() ? onSubmit(value.trim()) : onCancel()
        else if (e.key === 'Escape') onCancel()
      }}
    />
  )
}
