import { useState, useEffect, useCallback } from 'react'

interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

let toastListener: ((toast: Toast) => void) | null = null

export function showToast(message: string, type: Toast['type'] = 'info') {
  const toast: Toast = { id: Date.now().toString(), message, type }
  toastListener?.(toast)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((toast: Toast) => {
    setToasts(prev => [...prev, toast])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id))
    }, 3000)
  }, [])

  useEffect(() => {
    toastListener = addToast
    return () => { toastListener = null }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[90vw] max-w-sm">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`animate-slide-up rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'success' ? 'bg-profit text-primary-foreground' :
            toast.type === 'error' ? 'bg-destructive text-destructive-foreground' :
            'bg-secondary text-secondary-foreground'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
