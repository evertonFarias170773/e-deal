"use client";

import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { MOTIVO_ENTREGUE_MAXIMO, MOTIVO_ENTREGUE_MINIMO, motivoEntregueValido } from "@/features/orcamentos/lib/entregue-ajustavel";

/**
 * "Alterar pedido entregue" (23/11/2026, lib/entregue-ajustavel): pede o motivo
 * antes do Salvar de um pedido ENTREGUE sem nota, sem título e sem valor
 * recebido. O motivo vai para o chat do pedido. "Voltar" não grava nada.
 */
export function MotivoPedidoEntregueModal({
  onConfirmar,
  onVoltar
}: {
  onConfirmar: (motivo: string) => void;
  onVoltar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const motivo = motivoEntregueValido(texto);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-2xl bg-amber-50 p-3 text-amber-600">
            <PackageCheck className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold leading-tight text-slate-900">Alterar pedido entregue</h3>
            <p className="mt-1 text-sm text-slate-600">
              O pedido continua Entregue e as datas de envio não mudam. A diferença vai para a cobrança faturada a vencer,
              sem gerar crédito.
            </p>
          </div>
        </div>

        <label className="mt-4 block text-xs font-bold text-slate-700" htmlFor="motivo-pedido-entregue">
          Motivo da alteração (obrigatório)
        </label>
        <textarea
          id="motivo-pedido-entregue"
          autoFocus
          rows={3}
          maxLength={MOTIVO_ENTREGUE_MAXIMO}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border border-slate-200 p-3 text-sm text-slate-900 outline-none focus:border-amber-500"
          placeholder="Ex.: valor do produto renegociado com o cliente antes da nota"
        />
        <p className="mt-1 text-xs text-slate-500">
          Mínimo de {MOTIVO_ENTREGUE_MINIMO} caracteres. Fica registrado no chat do pedido.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onVoltar}
            className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={!motivo}
            onClick={() => motivo && onConfirmar(motivo)}
            className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
