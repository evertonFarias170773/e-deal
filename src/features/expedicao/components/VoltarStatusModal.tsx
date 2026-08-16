"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { voltarStatus } from "../services/expedicao-acoes.service";
import type { AtorExpedicao } from "../services/expedicao-acoes.service";
import type { PedidoExpedicao } from "../types";

export function VoltarStatusModal({
  pedido,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function handleConfirmar() {
    if (salvando) return;
    setSalvando(true);
    const res = await voltarStatus(pedido.idInt, pedido.statusInterno, motivo.trim(), ator);
    setSalvando(false);
    if (res.success) {
      showToast({ type: "success", title: "Status desfeito", description: `#${pedido.idInt} voltou um passo.` });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível voltar", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Voltar status #{pedido.idInt}</h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> Desfaz exatamente 1 passo do fluxo (status atual: {pedido.statusInterno}).
          </p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Motivo (obrigatório — fica na trilha)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ex.: marcado por engano, pedido voltou para retrabalho..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando || motivo.trim().length < 3} className="rounded-2xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {salvando ? "Voltando..." : "Voltar 1 passo"}
          </button>
        </div>
      </div>
    </div>
  );
}
