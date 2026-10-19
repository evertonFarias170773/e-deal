import React from "react";
import { X, Copy, RotateCcw } from "lucide-react";
import { ROTULO_DO_MOTIVO, type MotivoDaCopia } from "@/features/orcamentos/lib/motivo-copia";

type DuplicarPropostaModalProps = {
  propostaId: number;
  /** `null` enquanto a tela confere se o pedido já é cópia. */
  motivos: MotivoDaCopia[] | null;
  ehCopia: boolean | null;
  isOpen: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onEscolher: (motivo: MotivoDaCopia) => void;
};

const DESCRICAO: Record<MotivoDaCopia, string> = {
  DUPLICACAO: "Uma proposta nova com os mesmos itens e valores. É uma venda comum e entra no faturamento.",
  RETRABALHO:
    "Refazer o pedido. Leva os mesmos valores, nasce com \"Retrabalho do pedido #X\" na orientação técnica, exige a cobrança E-RETRABALHO e fica fora do faturamento."
};

/**
 * "Duplicação ou Retrabalho?" (19/10/2026) — as três portas do "Duplicar
 * proposta" (lista, detalhe e edição) passam por aqui, via `useDuplicarProposta`.
 * Sem escolha nada é criado: fechar ou cancelar não chama o banco. A escolha é
 * gravada para sempre (`propostas.motivo_copia`).
 */
export function DuplicarPropostaModal({
  propostaId,
  motivos,
  ehCopia,
  isOpen,
  isSubmitting = false,
  onClose,
  onEscolher
}: DuplicarPropostaModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div data-modal-motivo-copia className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-950">Duplicação ou Retrabalho?</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-slate-700">
          <p>
            Como a cópia da proposta <strong>#{propostaId}</strong> deve nascer? A escolha não pode ser trocada depois.
          </p>
          {ehCopia === true && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Este pedido já é uma cópia. Ele só pode gerar um retrabalho, que vai apontar para o #{propostaId}.
            </p>
          )}

          {!motivos ? (
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" aria-label="Conferindo o pedido" />
          ) : (
            <div className="space-y-3">
              {motivos.map((motivo) => (
                <button
                  key={motivo}
                  type="button"
                  data-motivo-copia={motivo}
                  onClick={() => onEscolher(motivo)}
                  disabled={isSubmitting}
                  className={`w-full rounded-2xl border p-4 text-left transition disabled:opacity-50 ${
                    motivo === "RETRABALHO" ? "border-red-200 hover:bg-red-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex items-center gap-2 font-semibold ${motivo === "RETRABALHO" ? "text-red-700" : "text-slate-950"}`}>
                    {motivo === "RETRABALHO" ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    {ROTULO_DO_MOTIVO[motivo]}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">{DESCRICAO[motivo]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-5 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
          >
            {isSubmitting ? "Criando..." : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
