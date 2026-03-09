import { useRef, useState } from 'react'

function DragDropFileInput({
  id,
  label,
  accept,
  multiple = false,
  required = false,
  disabled = false,
  onChange,
  inputKey,
  prompt = 'Arrastra archivos aqui o haz clic para seleccionar.',
  helperText = 'Maximo 25MB por archivo.',
}) {
  const inputRef = useRef(null)
  const [dragActive, setDragActive] = useState(false)

  const openPicker = () => {
    if (disabled) return
    inputRef.current?.click()
  }

  const emitDropEvent = (files) => {
    if (typeof onChange !== 'function') return
    onChange({
      target: {
        files,
        value: '',
      },
    })
  }

  return (
    <div className="file-drop-field">
      {label && <span>{label}</span>}
      <div
        className={`tasks-delivery-dropzone${dragActive ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onDragEnter={(event) => {
          if (disabled) return
          event.preventDefault()
          event.stopPropagation()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          if (disabled) return
          event.preventDefault()
          event.stopPropagation()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (disabled) return
          event.preventDefault()
          event.stopPropagation()
          setDragActive(false)
        }}
        onDrop={(event) => {
          if (disabled) return
          event.preventDefault()
          event.stopPropagation()
          setDragActive(false)
          emitDropEvent(Array.from(event.dataTransfer?.files || []))
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPicker()
          }
        }}
      >
        <p>{prompt}{required ? ' *' : ''}</p>
        {helperText && <small>{helperText}</small>}
        <input
          key={inputKey}
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          required={required}
          disabled={disabled}
          onChange={onChange}
          className="tasks-delivery-input"
        />
      </div>
    </div>
  )
}

export default DragDropFileInput
