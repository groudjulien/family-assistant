import { createContext, useContext, useState, type ReactNode } from "react";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  notify: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé dans un <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  const notify = (message: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, message }]);
    setTimeout(() => remove(id), 3500);
  };

  const api: ToastApi = {
    notify,
    success: (m) => notify(m, "success"),
    error: (m) => notify(m, "error"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <Notification key={t.id} kind={t.kind} message={t.message} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Notification réutilisable : verte (succès) ou rouge (erreur). */
export function Notification({
  kind,
  message,
  onClose,
}: {
  kind: ToastKind;
  message: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="alert"
      className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
        kind === "success" ? "bg-brand-600" : "bg-red-600"
      }`}
    >
      <span className="text-base leading-none">{kind === "success" ? "✓" : "✕"}</span>
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="ml-1 text-white/70 hover:text-white" aria-label="Fermer">
          ✕
        </button>
      )}
    </div>
  );
}
