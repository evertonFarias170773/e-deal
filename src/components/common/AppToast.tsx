"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  const [alertas, setAlertas] = useState<Toast[]>([]);

  const alertaAtual = alertas[0] ?? null;

  function removeToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function fecharAlerta() {
    setAlertas((current) => current.slice(1));
  }

  const showToast = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    const nextToast = { ...toast, id };

    /*
     * Erro vira alerta modal, não toast.
     *
     * Toast de canto some sozinho, e mensagem de erro raramente cabe no tempo de
     * leitura: a recusa do C6 no cancelamento passa de 100 caracteres e sumia
     * antes de o usuário terminar. Erro é justamente o que precisa ser lido, e
     * fechar deve ser decisão dele. Sucesso e info seguem como toast.
     *
     * A troca é feita aqui, num ponto só — as chamadas de showToast espalhadas
     * pela aplicação continuam iguais.
     */
    if (toast.type === "error") {
      setAlertas((current) => [...current, nextToast]);
      return;
    }

    setToasts((current) => [...current, nextToast]);

    window.setTimeout(() => {
      removeToast(id);
    }, toast.duration ?? 2600);
  }, []);

  // Esc fecha o alerta. Clique no fundo, não: sair sem querer de um erro que o
  // usuário ainda não leu recria o problema que este modal existe para resolver.
  useEffect(() => {
    if (!alertaAtual) return;

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") fecharAlerta();
    }

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alertaAtual]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        Acima de QUALQUER modal. Os diálogos da aplicação vão até z-[10000], e com
        z-[80] o toast renderizava atrás do backdrop: o erro era disparado, o
        usuário não via nada e a ação parecia morrer sem resposta — foi o que
        aconteceu na recusa de cancelamento do Banco Inter. Toast é a camada de
        aviso; se fica atrás de algo, ele não existe.
      */}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[10100] flex justify-center px-4 sm:justify-end">
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

      {/* Alerta de erro: fica até o usuário fechar. Mesmo z dos toasts, acima de
          qualquer diálogo da aplicação (que vão até z-[10000]). */}
      {alertaAtual ? (
        <div
          className="fixed inset-0 z-[10100] flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.8)", backdropFilter: "blur(4px)" }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alerta-titulo"
          aria-describedby={alertaAtual.description ? "alerta-descricao" : undefined}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-3xl border p-6 shadow-2xl toast-slide-down"
            style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            <div className="flex flex-col items-center gap-4 text-center">
              <div
                className="rounded-2xl p-3"
                style={{ background: "var(--card-hover)", color: toastAccentColors.error }}
              >
                <AlertTriangle className="h-8 w-8" />
              </div>

              <div className="space-y-2">
                <h4 id="alerta-titulo" className="text-base font-bold" style={{ color: "var(--foreground)" }}>
                  {alertaAtual.title}
                </h4>
                {alertaAtual.description ? (
                  <p
                    id="alerta-descricao"
                    className="text-sm leading-relaxed whitespace-pre-line break-words"
                    style={{ color: "var(--muted)" }}
                  >
                    {alertaAtual.description}
                  </p>
                ) : null}
              </div>

              {alertas.length > 1 ? (
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {alertas.length - 1} outro aviso aguardando
                </p>
              ) : null}
            </div>

            <button
              type="button"
              autoFocus
              onClick={() => {
                // Preserva o contrato do showToast: erros com ação continuam
                // executando a ação, agora por decisão explícita do usuário.
                alertaAtual.onClick?.();
                fecharAlerta();
              }}
              className="mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
              style={{ background: toastAccentColors.error }}
            >
              Entendi
            </button>
          </div>
        </div>
      ) : null}
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
