import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const existingTimer = timersRef.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    // Match original single-toast replacement ergonomics while preserving clean transitions
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts([{ id, message, type }]);

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, 4200);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => {
          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error' || toast.type === 'warning'
                ? AlertTriangle
                : Info;
          const iconColor =
            toast.type === 'success'
              ? '#34d399'
              : toast.type === 'error'
                ? '#f87171'
                : toast.type === 'warning'
                  ? '#fbbf24'
                  : '#60a5fa';

          return (
            <div
              key={toast.id}
              role="status"
              className={`toast-notification toast-${toast.type}`}
              onClick={() => dismissToast(toast.id)}
            >
              <Icon size={16} style={{ flexShrink: 0, color: iconColor }} />
              <span>{toast.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
