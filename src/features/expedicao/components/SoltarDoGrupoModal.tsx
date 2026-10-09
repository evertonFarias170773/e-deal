"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { soltarAcompanhar } from "@/features/orcamentos/services/acompanhar.client";
import type { GrupoVinculado } from "../lib/vinculos-do-painel";

/**
 * "Soltar do grupo" (admin da Expedicao, Fase 7): tira um pedido do grupo
 * Acompanhar para destravar quem ficou parado. Motivo obrigatorio. Usa a rota
 * `/api/orcamentos/acompanhar` (`soltar_pedido_vinculo`); a permissao vale no
 * servidor e no banco, o botao so aparece para quem tem `expedicao.admin`.
 * O grupo se desfaz sozinho quando sobra um pedido.
 */
export function SoltarDoGrupoModal({
  idInt,
  grupo,
  onClose,
  onDone
}: {
  /** O pedido do card em que o botao foi clicado. */
  idInt: number;
  grupo: GrupoVinculado;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const [solta, setSolta] = useState(idInt);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const pedidos = [idInt, ...grupo.membros.map((m) => m.idInt)];

  async function confirmar() {
    if (salvando) return;
    setSalvando(true);
    const res = await soltarAcompanhar(idInt, motivo.trim(), solta);
    setSalvando(false);
    if (res.success) {
      showToast({ type: "success", title: "Pedido solto do grupo", description: `#${solta} saiu do grupo Acompanhar.` });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível soltar", description: res.errorMessage });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Soltar do grupo</h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Tira o pedido escolhido do grupo Acompanhar. Os outros seguem juntos; se sobrar um só, o grupo se desfaz.
          </p>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Pedido a soltar</label>
            <select
              value={solta}
              onChange={(e) => setSolta(Number(e.target.value))}
              disabled={salvando}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {pedidos.map((id) => (
                <option key={id} value={id}>
                  #{id}
                  {id === idInt ? " (este cartão)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Motivo (obrigatório — fica na trilha)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ex.: o outro pedido está parado e este precisa sair hoje"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando || motivo.trim().length < 3} className="rounded-2xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {salvando ? "Soltando..." : "Soltar do grupo"}
          </button>
        </div>
      </div>
    </div>
  );
}
