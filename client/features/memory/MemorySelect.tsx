// Native select styled like the Permissions page's mode select: the UI kit has
// no select primitive, and DESIGN.md allows a specialized native control.

type MemorySelectProps<T extends string> = {
  label: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  disabled?: boolean
  onChange: (value: T) => void
}

export function MemorySelect<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange
}: MemorySelectProps<T>) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as T)}
      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
    >
      {options.map(option => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
