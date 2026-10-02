"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Moldura simples de modal: fundo escuro, Esc fecha, largura de formulario.
 * z-[9000]: acima do drawer do chat (z-[70]/[80]), abaixo do toast (z-[10100]).
 */
export function ModalBase({
  titulo,
  onFechar,
  children,
  rodape
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border shadow-2xl sm:max-w-lg sm:rounded-2xl"
        style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-base font-bold">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-lg p-1.5 transition hover:opacity-70"
            style={{ color: "var(--muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {rodape ? (
          <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
            {rodape}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const campoClasse = "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--primary)]";
export const campoEstilo = { background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" };
export const rotuloClasse = "mb-1 block text-xs font-semibold";
