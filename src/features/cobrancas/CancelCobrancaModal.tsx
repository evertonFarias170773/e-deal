"use client";

import { useEffect, useState } from "react";
import { X, AlertCircle } from "lucide-react";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAppToast } from "@/components/common/AppToast";

interface CancelCobrancaModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobrancaId: string;
  onSuccess?: () => void;
}

export function CancelCobrancaModal({ isOpen, onClose, cobrancaId, onSuccess }: CancelCobrancaModalProps) {
  const { cancelCobranca } = useCobrancas();
  const { showToast } = useAppToast();
  const [motivo, setMotivo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setMotivo("");
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConfirm() {
    if (!motivo.trim()) {
      showToast({ type: "error", title: "Motivo obrigatório", description: "Informe o motivo do cancelamento." });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await cancelCobranca(cobrancaId, motivo.trim());
      if (result.success) {
        showToast({ type: "success", title: "Cobrança cancelada com sucesso." });
        onSuccess?.();
        onClose();
      } else {
        showToast({
          type: "error",
          title: "Erro ao cancelar cobrança",
          description: result.errorMessage || "Não foi possível cancelar a cobrança."
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Cancelar Cobrança</h2>
            <p className="text-sm text-slate-500 mt-1">Essa ação é irreversível.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex gap-3 items-start">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Confirmação de Cancelamento</p>
              <p className="mt-1 leading-relaxed">
                Você está prestes a cancelar a cobrança ativa. É necessário preencher um motivo para auditoria.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="motivo_cancelamento" className="text-xs font-semibold text-slate-700">
              Motivo do Cancelamento <span className="text-red-500">*</span>
            </label>
            <textarea
              id="motivo_cancelamento"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={isSubmitting}
              placeholder="Digite o motivo detalhado..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !motivo.trim()}
            className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {isSubmitting ? "Cancelando..." : "Confirmar Cancelamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
