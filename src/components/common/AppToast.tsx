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
};

type Toast = ToastInput & {
  id: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toastStyles: Record<ToastType, string> = {
  success: "border-teal-200 bg-white text-teal-800",
  error: "border-red-200 bg-white text-red-800",
  warning: "border-orange-200 bg-white text-orange-800",
  info: "border-sky-200 bg-white text-sky-800"
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

            return (
              <div
                key={toast.id}
                className={cn(
                  "pointer-events-auto flex gap-3 rounded-3xl border p-4 shadow-xl shadow-slate-900/10 toast-slide-down",
                  toastStyles[toast.type]
                )}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-sm text-slate-600">{toast.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="rounded-xl p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Fechar notificacao"
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
