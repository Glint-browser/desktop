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
    const grab = (): void => {
      ref.current?.focus()
      ref.current?.select()
    }
    grab()
    // Late default-focus handling from the opening click can still land on
    // <body> right after mount; take focus back on the next frame.
    const raf = requestAnimationFrame(grab)
    return () => cancelAnimationFrame(raf)
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
