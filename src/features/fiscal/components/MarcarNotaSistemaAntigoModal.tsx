"use client";

import { useState } from "react";
import { FileCheck2, Loader2, X } from "lucide-react";
import { normalizarNumeroNotaAntiga } from "../lib/faturado-fora";

/**
 * "Nota emitida no sistema antigo": pede o número da nota antes de marcar.
 *
 * Usado pela Fila de Faturamento. A marca só registra que a nota existe fora do
 * Vibe; quem grava é a rota POST /api/fiscal/faturado-fora.
 */
export function MarcarNotaSistemaAntigoModal({
  idInt,
  salvando,
  onConfirmar,
  onFechar
}: {
  idInt: number;
  salvando: boolean;
  onConfirmar: (numeroNota: string, motivo: string | null) => void;
  onFechar: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [motivo, setMotivo] = useState("");
  const numeroValido = normalizarNumeroNotaAntiga(numero);

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start gap-3 border-b border-slate-100">
          <div className="p-3 bg-slate-100 text-slate-700 rounded-2xl shrink-0">
            <FileCheck2 className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900 leading-tight">Nota emitida no sistema antigo</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pedido <span className="font-mono font-semibold">#{idInt}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="px-6 py-5 space-y-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (numeroValido && !salvando) onConfirmar(numeroValido, motivo.trim() || null);
          }}
        >
          <p className="text-sm text-slate-600">
            Use só quando a NF-e deste pedido já foi emitida no sistema antigo. Uma venda, uma nota: o pedido
            marcado não entra na Fila de Faturamento e o <strong>Faturar</strong> o recusa. Liberação para nota,
            status e produção não mudam.
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Número da nota no sistema antigo *
            </span>
            <input
              autoFocus
              inputMode="numeric"
              value={numero}
              onChange={(evento) => setNumero(evento.target.value.replace(/\D/g, "").slice(0, 9))}
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observação (opcional)</span>
            <input
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value.slice(0, 300))}
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]"
            />
          </label>
          <p className="text-xs text-slate-500">
            O número, quem marcou e quando ficam na linha do tempo do pedido. Para desfazer: Orçamentos, menu da linha
            do pedido.
          </p>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onFechar}
              className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!numeroValido || salvando}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl shadow-sm transition disabled:opacity-50"
            >
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Marcar nota emitida
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
