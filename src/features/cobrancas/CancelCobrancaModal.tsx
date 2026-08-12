"use client";

import { useEffect, useState } from "react";
import { X, AlertCircle } from "lucide-react";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { useAppToast } from "@/components/common/AppToast";
import {
  DESTINOS_VALOR_CANCELADO,
  MOTIVOS_CANCELAMENTO_PAGO,
  type DestinoValorCancelado,
  type MotivoCancelamentoPago
} from "@/features/cobrancas/cancelamento-pago";

interface CancelCobrancaModalProps {
  isOpen: boolean;
  onClose: () => void;
  cobrancaId: string;
  onSuccess?: () => void;
  /** Cobrança já paga? Muda o formulário inteiro — ver comentário abaixo. */
  isCobrancaPaga: boolean;
  /** "agosto/2026" quando a confirmação caiu em mês já fechado; null caso contrário. */
  mesFechadoLabel: string | null;
}

// Dois modos de proposito: cobranca NAO paga segue com motivo livre (fluxo de
// sempre); cobranca paga exige motivo de catalogo + destino do valor, porque e
// operacao excepcional de super admin que mexe em receita ja reconhecida.

export function CancelCobrancaModal({
  isOpen,
  onClose,
  cobrancaId,
  onSuccess,
  isCobrancaPaga,
  mesFechadoLabel
}: CancelCobrancaModalProps) {
  const { cancelCobranca } = useCobrancas();
  const { showToast } = useAppToast();

  // Fluxo antigo (cobrança não paga): motivo em texto livre.
  const [motivo, setMotivo] = useState("");

  // Fluxo novo (cobrança paga): motivo de catálogo, texto extra só quando o
  // motivo exigir, destino do valor e confirmação de mês fechado.
  const [motivoCodigo, setMotivoCodigo] = useState<MotivoCancelamentoPago | "">("");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [destino, setDestino] = useState<DestinoValorCancelado | "">("");
  const [confirmaMesFechado, setConfirmaMesFechado] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const motivoSelecionado = MOTIVOS_CANCELAMENTO_PAGO.find((m) => m.codigo === motivoCodigo) || null;
  const exigeTexto = motivoSelecionado?.exigeTexto ?? false;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setMotivo("");
      setMotivoCodigo("");
      setMotivoTexto("");
      setDestino("");
      setConfirmaMesFechado(false);
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

  // Trocar o motivo já pré-marca o destino sugerido pelo catálogo; o usuário
  // ainda pode escolher outro destino manualmente depois.
  function handleMotivoChange(valor: string) {
    const novoMotivo = valor as MotivoCancelamentoPago;
    setMotivoCodigo(novoMotivo);
    const catalogo = MOTIVOS_CANCELAMENTO_PAGO.find((m) => m.codigo === novoMotivo);
    if (catalogo) {
      setDestino(catalogo.destinoSugerido);
    }
  }

  const podeConfirmar = isCobrancaPaga
    ? Boolean(motivoCodigo) && (!exigeTexto || motivoTexto.trim().length > 0) && (!mesFechadoLabel || confirmaMesFechado)
    : motivo.trim().length > 0;

  async function handleConfirmNaoPaga() {
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

  async function handleConfirmPaga() {
    if (!motivoCodigo) {
      showToast({ type: "error", title: "Motivo obrigatório", description: "Selecione o motivo do cancelamento." });
      return;
    }
    if (exigeTexto && !motivoTexto.trim()) {
      showToast({ type: "error", title: "Detalhe obrigatório", description: "Descreva o motivo do cancelamento." });
      return;
    }
    if (!destino) {
      showToast({ type: "error", title: "Destino obrigatório", description: "Selecione o destino do valor." });
      return;
    }
    if (mesFechadoLabel && !confirmaMesFechado) {
      showToast({
        type: "error",
        title: "Confirmação obrigatória",
        description: `Confirme que o faturamento de ${mesFechadoLabel} será alterado.`
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await cancelCobranca(cobrancaId, "", {
        motivo: motivoCodigo,
        motivoTexto: motivoTexto.trim(),
        destino,
        confirmaMesFechado
      });
      if (result.success) {
        showToast({ type: "success", title: "Cobrança cancelada com sucesso." });
        onSuccess?.();
        onClose();
      } else {
        // NEGADO (não é super admin) e os demais códigos da rota usam o mesmo
        // alerta padronizado que qualquer erro do app — showToast({ type: "error" })
        // já abre modal, não toast (ver AppToastProvider).
        showToast({
          type: "error",
          title: result.code === "NEGADO" ? "Acesso negado" : "Erro ao cancelar cobrança",
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

  function handleConfirm() {
    void (isCobrancaPaga ? handleConfirmPaga() : handleConfirmNaoPaga());
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

          {!isCobrancaPaga ? (
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
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="motivo_cancelamento_pago" className="text-xs font-semibold text-slate-700">
                  Motivo do Cancelamento <span className="text-red-500">*</span>
                </label>
                <select
                  id="motivo_cancelamento_pago"
                  value={motivoCodigo}
                  onChange={(e) => handleMotivoChange(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {MOTIVOS_CANCELAMENTO_PAGO.map((m) => (
                    <option key={m.codigo} value={m.codigo}>{m.rotulo}</option>
                  ))}
                </select>
              </div>

              {exigeTexto ? (
                <div className="space-y-1.5">
                  <label htmlFor="motivo_texto_pago" className="text-xs font-semibold text-slate-700">
                    Detalhe o motivo <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="motivo_texto_pago"
                    rows={3}
                    value={motivoTexto}
                    onChange={(e) => setMotivoTexto(e.target.value)}
                    disabled={isSubmitting}
                    placeholder="Digite o motivo detalhado..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:opacity-50"
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 block">
                  Destino do valor <span className="text-red-500">*</span>
                </span>
                <div className="space-y-2">
                  {DESTINOS_VALOR_CANCELADO.map((d) => {
                    const checked = destino === d.codigo;
                    return (
                      <label
                        key={d.codigo}
                        className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm transition ${
                          checked ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        <input
                          type="radio"
                          name="destino_valor_cancelado"
                          value={d.codigo}
                          checked={checked}
                          onChange={() => setDestino(d.codigo)}
                          disabled={isSubmitting}
                          className="h-4 w-4 accent-red-600"
                        />
                        {d.rotulo}
                      </label>
                    );
                  })}
                </div>
              </div>

              {mesFechadoLabel ? (
                <label className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <input
                    type="checkbox"
                    checked={confirmaMesFechado}
                    onChange={(e) => setConfirmaMesFechado(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 h-4 w-4 accent-red-600"
                  />
                  <span>Entendo que o faturamento de {mesFechadoLabel} será alterado.</span>
                </label>
              ) : null}
            </div>
          )}
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
            disabled={isSubmitting || !podeConfirmar}
            className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {isSubmitting ? "Cancelando..." : "Confirmar Cancelamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
