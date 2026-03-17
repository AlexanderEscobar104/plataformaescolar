import { useId, useMemo, useState } from 'react'

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c-6 0-10 7-10 7s4 7 10 7 10-7 10-7-4-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.3 2.6 2 3.9l3.1 3.1C3.2 8.6 2 12 2 12s4 7 10 7c1.7 0 3.3-.5 4.7-1.2l3.4 3.4 1.3-1.3L3.3 2.6ZM12 17c-4 0-7-4-7-5 0-.4 1-2.5 2.8-3.9l1.6 1.6A4 4 0 0 0 12 16c.5 0 1-.1 1.4-.3l1.6 1.6c-.9.4-1.9.7-3 .7Zm9.9-5c-.3.6-1.3 2.6-3 4l-1.5-1.5c1.5-1.2 2.4-2.9 2.7-3.5-.7-1.2-3.2-5-8.1-5-1 0-2 .2-2.8.5L7.6 5.9C9 5.3 10.5 5 12 5c6 0 10 7 10 7s0 0-.1 0Z" />
    </svg>
  )
}

function PasswordField({
  id,
  label = 'Contrasena',
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  required,
  className,
  inputProps,
}) {
  const generatedId = useId()
  const resolvedId = id || useMemo(() => `password-${generatedId.replace(/:/g, '')}`, [generatedId])
  const [visible, setVisible] = useState(false)

  return (
    <label htmlFor={resolvedId} className={className}>
      {label}
      <div className="password-input-wrap">
        <input
          id={resolvedId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          {...(inputProps || {})}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contrasena' : 'Ver contrasena'}
          title={visible ? 'Ocultar' : 'Ver'}
          tabIndex={-1}
          disabled={disabled}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </label>
  )
}

export default PasswordField

