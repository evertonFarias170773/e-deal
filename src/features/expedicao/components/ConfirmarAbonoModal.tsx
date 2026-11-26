"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { MOTIVO_ABONO_MINIMO } from "../lib/abono-frete";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Confirmação da troca de transportadora ABONANDO a diferença (26/11/2026).
 *
 * Usada no Despachar (Expedição) e no quadro "Trocar abonando" da aba Fretes:
 * mesmo texto, mesmo motivo obrigatório, mesma rota. Diz com todas as letras
 * que o cliente NÃO paga a mais e quanto a empresa absorve.
 */
export function ConfirmarAbonoModal({
  transportadora,
  servico,
  valorOpcao,
  freteAtual,
  temNotaAutorizada,
  salvando,
  onConfirmar,
  onClose
}: {
  transportadora: string;
  servico: string;
  valorOpcao: number;
  freteAtual: number;
  /** Mostra o aviso da CC-e já na confirmação. A rota devolve os números das notas. */
  temNotaAutorizada?: boolean;
  salvando: boolean;
  onConfirmar: (motivo: string) => void;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const abono = Math.round((valorOpcao - freteAtual) * 100) / 100;
  const motivoOk = motivo.trim().length >= MOTIVO_ABONO_MINIMO;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!salvando) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Trocar abonando a diferença</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-6 text-sm text-slate-700 dark:text-slate-300">
          <p>
            A transportadora passa a ser <strong>{transportadora}</strong>
            {servico && servico !== transportadora ? ` (${servico})` : ""}, que custa <strong>{brl(valorOpcao)}</strong>.
          </p>
          <p>
            O cliente continua pagando <strong>{brl(freteAtual)}</strong> de frete e o total do pedido não muda. A empresa
            abona <strong>{brl(abono)}</strong>, registrado no histórico da recotação com o seu nome.
          </p>
          {temNotaAutorizada ? (
            <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              O pedido tem NF-e autorizada. O valor da nota não muda, mas ela continua com a transportadora antiga: emita uma
              Carta de Correção (CC-e) com a transportadora nova.
            </p>
          ) : null}
          <label className="block">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Motivo do abono (obrigatório)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              disabled={salvando}
              placeholder="Ex.: cliente precisa receber amanhã e o SEDEX não atende a cidade."
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivo.trim())}
            disabled={salvando || !motivoOk}
            className="rounded-2xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {salvando ? "Trocando…" : `Trocar e abonar ${brl(abono)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
