"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

type ToastInput = {
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  onClick?: () => void;
};

type Toast = ToastInput & {
  id: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Usando tokens CSS via inline style para dark mode automático
const toastAccentColors: Record<ToastType, string> = {
  success: "var(--secondary)",       // teal
  error:   "var(--action-danger)",   // red
  warning: "var(--accent)",          // orange
  info:    "var(--action-edit)"      // blue
};

const toastIcons = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info
};

export function AppToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function removeToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const showToast = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    const nextToast = { ...toast, id };

    setToasts((current) => [...current, nextToast]);

    window.setTimeout(() => {
      removeToast(id);
    }, toast.duration ?? 2600);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex justify-center px-4 sm:justify-end">
        <div className="flex w-full max-w-md flex-col gap-3">
          {toasts.map((toast) => {
            const Icon = toastIcons[toast.type];
            const accentColor = toastAccentColors[toast.type];

            return (
              <div
                key={toast.id}
                className={cn(
                  "pointer-events-auto flex gap-3 rounded-2xl border p-4 shadow-xl toast-slide-down",
                  toast.onClick && "cursor-pointer select-none hover:opacity-95"
                )}
                onClick={toast.onClick}
                style={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  borderLeftColor: accentColor,
                  borderLeftWidth: "4px",
                  color: "var(--foreground)"
                }}
              >
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0"
                  style={{ color: accentColor }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold" style={{ color: "var(--foreground)" }}>{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="rounded-xl p-1 transition"
                  style={{ color: "var(--muted)" }}
                  aria-label="Fechar notificacao"
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.background = "var(--card-hover)";
                    el.style.color = "var(--foreground)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLButtonElement;
                    el.style.background = "transparent";
                    el.style.color = "var(--muted)";
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useAppToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useAppToast deve ser usado dentro de AppToastProvider.");
  }

  return context;
}
