import { useState, useRef, useEffect, useMemo } from 'react';

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Buscar y seleccionar...',
  id,
  disabled
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);

  const selectedOption = useMemo(() => {
    return options.find(opt => opt.value === value);
  }, [options, value]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options;
    return options.filter(opt =>
      opt.label.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [options, searchTerm]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div
        style={{ margin: 0, padding: 0, border: 'none', width: '100%' }}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
      >
        <input
          id={id}
          type="text"
          readOnly={!isOpen}
          disabled={disabled}
          value={isOpen ? searchTerm : (selectedOption ? selectedOption.label : '')}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          onChange={(e) => {
            if (isOpen) setSearchTerm(e.target.value);
          }}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setSearchTerm(''); // Clear to show all/search new
            }
          }}
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: '1rem',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            cursor: disabled ? 'not-allowed' : 'text',
            backgroundColor: disabled ? 'var(--bg-secondary)' : 'var(--bg-primary, #fff)',
            color: 'var(--text-color)',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888', fontSize: '0.8rem' }}>
          ▼
        </div>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: '350px',
            overflowY: 'auto',
            background: 'var(--bg-primary, #fff)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            zIndex: 1000,
            marginTop: '4px'
          }}
        >
          {filteredOptions.length === 0 ? (
            <div style={{ padding: '8px 12px', color: '#888' }}>No se encontraron resultados</div>
          ) : (
            filteredOptions.map((opt) => (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                  setSearchTerm('');
                }}
                style={{
                  padding: '12px 14px',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: value === opt.value ? 'var(--bg-secondary)' : 'transparent',
                  color: 'var(--text-color)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = value === opt.value ? 'var(--bg-secondary)' : 'transparent')}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
