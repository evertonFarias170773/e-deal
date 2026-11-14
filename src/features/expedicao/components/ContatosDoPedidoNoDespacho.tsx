"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { numeroParaExibir } from "@/features/orcamentos/lib/conversa-whatsapp";

/**
 * CONTATOS DO PEDIDO NO DESPACHO (14/11/2026, decisão da diretoria).
 *
 * As conversas do ChatGuru escolhidas na aba Geral (`propostas_contatos_chatguru`),
 * a principal primeiro. A Expedição usa as escolhidas e não oferece a lista de
 * conversas de novo: o aviso de pedido pronto vai para a principal, que a
 * proposta já guarda em `chatguru_chat_id`. Só leitura.
 *
 * Pedido antigo sem conversa escolhida: nada aparece aqui e o despacho segue como
 * antes.
 */

type Linha = { chat_id: string; nome: string | null; telefone: string | null; principal: boolean };

export function ContatosDoPedidoNoDespacho({ idInt, className = "" }: { idInt: number; className?: string }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const client = getSupabaseClient();
    if (!client || !Number.isInteger(idInt) || idInt <= 0) return;
    client
      .from("propostas_contatos_chatguru")
      .select("chat_id, nome, telefone, principal")
      .eq("id_int", idInt)
      .order("principal", { ascending: false })
      .order("escolhido_em", { ascending: true })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro("Não foi possível ler os contatos do pedido.");
        else setLinhas((data ?? []) as Linha[]);
      });
    return () => {
      vivo = false;
    };
  }, [idInt]);

  if (erro) return <p className={`text-xs text-red-600 ${className}`}>{erro}</p>;
  if (!linhas || linhas.length === 0) return null;

  return (
    <div
      data-contatos-do-pedido-despacho
      className={`rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30 ${className}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Contatos do pedido · WhatsApp (ChatGuru)
      </p>
      <ul className="mt-2 space-y-1.5">
        {linhas.map((l) => (
          <li key={l.chat_id} className="flex flex-wrap items-center gap-2">
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span className="font-semibold text-slate-800 dark:text-slate-100">{l.nome || "—"}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{l.telefone ? numeroParaExibir(l.telefone) : ""}</span>
            {l.principal && (
              <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white">Principal · recebe o aviso</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
