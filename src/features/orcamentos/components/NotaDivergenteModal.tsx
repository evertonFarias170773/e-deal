"use client";

import { AlertTriangle } from "lucide-react";
import { formatarReais, rotuloDaNotaViva, type NotaViva } from "@/features/orcamentos/lib/nota-x-pedido";

/**
 * "Este pedido já tem NF-e de venda" — aviso do Salvar quando total, desconto ou
 * frete mudam (lib/nota-x-pedido). Só aviso: "Salvar mesmo assim" grava; "Voltar"
 * não grava nada.
 */
export function NotaDivergenteModal({
  notas,
  totalNovo,
  onSalvar,
  onVoltar
}: {
  notas: readonly NotaViva[];
  totalNovo: number;
  onSalvar: () => void;
  onVoltar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-2xl bg-amber-50 p-3 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold leading-tight text-slate-900">Este pedido já tem NF-e de venda</h3>
            <p className="mt-1 text-sm text-slate-600">
              A nota não muda quando o pedido muda. Salvar agora deixa o pedido com valor diferente da nota.
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 p-4 text-sm">
          {notas.map((nota) => (
            <div key={nota.ref} className="flex justify-between gap-3">
              <dt className="text-slate-500">Nota</dt>
              <dd className="text-right font-semibold text-slate-900">{rotuloDaNotaViva(nota)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Novo total do pedido</dt>
            <dd className="font-semibold text-slate-900">{formatarReais(totalNovo)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-slate-500">
          Se salvar, fica registrado na linha do tempo do pedido que ele foi salvo com valor diferente da nota.
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onVoltar}
            className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={onSalvar}
            className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700"
          >
            Salvar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}
