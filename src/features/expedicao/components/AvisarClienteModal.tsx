"use client";

import { useMemo } from "react";
import { MessageCircle, X } from "lucide-react";
import { AvisoPedidoPronto } from "./AvisoPedidoPronto";
import { useAvisosPedidoPronto } from "../hooks/useAvisosPedidoPronto";

/**
 * "Avisar cliente" no menu ⋯ do card (10/11/2026). O aviso de pedido pronto sai
 * no "Confirmar despacho"; esta janela é o caminho do reenvio, do aviso que não
 * saiu, do "Ver conversas do cliente", do "Liberar número" e do status. Lê só o
 * aviso deste pedido, ao abrir.
 */
export function AvisarClienteModal({
  idInt,
  statusInterno,
  podeOperar,
  ehAdm,
  onClose
}: {
  idInt: number;
  statusInterno: string;
  podeOperar: boolean;
  ehAdm: boolean;
  onClose: () => void;
}) {
  const pedidos = useMemo(() => [{ idInt, statusInterno }], [idInt, statusInterno]);
  const avisos = useAvisosPedidoPronto(pedidos, true);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-100">
            <MessageCircle className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            Avisar cliente <span className="font-extrabold">#{idInt}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 p-6 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aviso de pedido pronto pelo WhatsApp da Ideal (ChatGuru). Ele sai no Confirmar despacho; aqui fica o reenvio.
          </p>
          {!avisos.carregado ? (
            <p>Lendo o aviso do pedido...</p>
          ) : (
            <AvisoPedidoPronto
              idInt={idInt}
              statusInterno={statusInterno}
              aviso={avisos.avisos.get(idInt)}
              modoTeste={avisos.modoTeste}
              podeOperar={podeOperar}
              ehAdm={ehAdm}
              recusaNumero={avisos.recusas.get(idInt)}
              modelo={avisos.modelos.get(idInt)}
              teste={avisos.testes.get(idInt)}
              naJanela
              onAviso={avisos.atualizar}
            />
          )}
          {avisos.carregado && avisos.erro && <p className="text-xs text-red-700 dark:text-red-300">{avisos.erro}</p>}
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
