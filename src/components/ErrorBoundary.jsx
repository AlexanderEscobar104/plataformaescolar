/**
 * ErrorBoundary Component
 * ✅ CORRECCIÓN: Prevenir crash total de la app
 * 
 * Captura errores en React components y muestra una UI de recuperación
 * sin derribar toda la aplicación.
 * 
 * Uso:
 *   <ErrorBoundary>
 *     <YourComponent />
 *   </ErrorBoundary>
 */

import { Component } from 'react'
import PropTypes from 'prop-types'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error, errorInfo) {
    // Loguear error para debugging
    console.error('🔴 Error Boundary caught:', {
      error: error.toString(),
      errorInfo: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    })

    // Actualizar estado con información del error
    this.setState((prevState) => ({
      errorInfo,
      errorCount: prevState.errorCount + 1,
    }))

    // En producción, enviar a servicio de monitoreo (Sentry, LogRocket, etc)
    if (import.meta.env.PROD && window.__SENTRY__) {
      window.__SENTRY__.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo.componentStack,
          },
        },
      })
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
  }

  render() {
    const { hasError, error, errorCount } = this.state
    const { children } = this.props

    if (hasError) {
      return (
        <main className="page">
          <section className="card" style={{ textAlign: 'center', padding: '2rem' }}>
            <h1 style={{ color: '#dc2626', marginBottom: '1rem' }}>
              ⚠️ Algo salió mal
            </h1>

            <p style={{ color: '#666', marginBottom: '1rem', fontSize: '1rem' }}>
              {error?.message || 'Se ha producido un error inesperado.'}
            </p>

            {errorCount > 2 && (
              <p style={{ color: '#d97706', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                Este error ha ocurrido múltiples veces ({errorCount}). 
                Por favor, <strong>recarga la página</strong> o contacta a soporte.
              </p>
            )}

            {import.meta.env.DEV && error?.stack && (
              <details
                style={{
                  textAlign: 'left',
                  backgroundColor: '#f3f4f6',
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.75rem',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                  Stack Trace (Desarrollo solamente)
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem' }}>
                  {error.stack}
                </pre>
              </details>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={this.handleReset}
                style={{
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                Intentar de nuevo
              </button>

              <button
                onClick={() => {
                  window.location.href = '/dashboard'
                }}
                style={{
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                Volver al inicio
              </button>

              <button
                onClick={() => {
                  window.location.reload()
                }}
                style={{
                  backgroundColor: '#6b7280',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                }}
              >
                Recargar página
              </button>
            </div>
          </section>
        </main>
      )
    }

    return children
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
}
