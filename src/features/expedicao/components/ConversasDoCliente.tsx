"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import {
  verConversasDoCliente,
  type ConversaChatGuru,
  type EscolhaConversa,
  type SelecaoConversas
} from "../services/aviso-pronto.client";

/**
 * Conversas do cliente no ChatGuru (remetente 3478), 09/11/2026. Fonte única dos
 * avisos (pedido pronto e pedido em produção): a visão chatguru_contatos_3478,
 * lida só pelo servidor. Nada aqui grava em contatos nem nas tabelas do ChatGuru.
 */

export const MOTIVO_ESCOLHA: Record<EscolhaConversa["motivo"], string> = {
  varias: "O WhatsApp do contato responsável casa com mais de uma conversa do cliente no ChatGuru. Escolha para qual enviar.",
  nenhuma: "O WhatsApp do contato responsável não casa com nenhuma conversa do cliente no ChatGuru. Escolha para qual enviar."
};

/**
 * Lista com marcação (uma, várias ou todas). `selecionadas` é controlada por quem
 * usa; `onEnviarUma` mostra o "Enviar para esta" em cada linha.
 */
export function ListaConversas({
  conversas,
  selecionadas,
  onChange,
  onEnviarUma,
  disabled = false
}: {
  conversas: ConversaChatGuru[];
  selecionadas: string[];
  onChange: (chatIds: string[]) => void;
  onEnviarUma?: (chatId: string) => void;
  disabled?: boolean;
}) {
  const marcar = (id: string, sim: boolean) =>
    onChange(sim ? Array.from(new Set([...selecionadas, id])) : selecionadas.filter((x) => x !== id));
  const todas = conversas.length > 0 && conversas.every((c) => selecionadas.includes(c.chat_id));
  return (
    <div className="space-y-1">
      {conversas.length > 1 && (
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            disabled={disabled}
            checked={todas}
            onChange={(e) => onChange(e.target.checked ? conversas.map((c) => c.chat_id) : [])}
          />
          Todas ({conversas.length})
        </label>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {conversas.map((c) => (
          <li key={c.chat_id} className="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              aria-label={`Marcar ${c.nome}`}
              disabled={disabled}
              checked={selecionadas.includes(c.chat_id)}
              onChange={(e) => marcar(c.chat_id, e.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{c.nome}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{c.numero}</span>
            </span>
            {onEnviarUma && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onEnviarUma(c.chat_id)}
                className="shrink-0 text-xs font-semibold text-emerald-800 underline-offset-2 hover:underline disabled:opacity-50 dark:text-emerald-300"
              >
                Enviar para esta
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Janela das conversas do cliente: a escolha quando a regra não decide e o "Ver
 * conversas do cliente" (que substitui o "Corrigir número"). Sem `inicial`, lê a
 * lista no servidor. Com `onEnviar`, permite enviar para uma, várias ou todas,
 * sempre com confirmação.
 */
export function ConversasDoClienteModal({
  idInt,
  titulo,
  inicial,
  descricaoEnvio,
  ocupado = false,
  onEnviar,
  onClose
}: {
  idInt: number;
  titulo: string;
  inicial?: EscolhaConversa | null;
  /** O que acontece ao enviar (ex.: "O cliente vai receber o aviso de pedido pronto."). */
  descricaoEnvio?: string;
  ocupado?: boolean;
  onEnviar?: (selecao: SelecaoConversas) => void;
  onClose: () => void;
}) {
  const [conversas, setConversas] = useState<ConversaChatGuru[] | null>(inicial?.conversas ?? null);
  const [nota, setNota] = useState<string | null>(inicial ? MOTIVO_ESCOLHA[inicial.motivo] : null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [confirmando, setConfirmando] = useState<SelecaoConversas | null>(null);

  useEffect(() => {
    if (inicial) return;
    let vivo = true;
    void (async () => {
      const res = await verConversasDoCliente(idInt);
      if (!vivo) return;
      if (!res.ok) {
        setErro(res.mensagem ?? "Não foi possível ler as conversas do cliente.");
        setConversas([]);
        return;
      }
      const lista = res.conversas ?? [];
      setConversas(lista);
      const d = res.decisao;
      if (d?.modo === "sem_conversa") setNota(d.mensagem);
      else if (d?.modo === "escolha") setNota(MOTIVO_ESCOLHA[d.motivo]);
      else if (d?.modo === "automatica") {
        const c = lista.find((x) => x.chat_id === d.chat_id);
        setNota(c ? `Pela regra, o aviso vai para ${c.nome} (${c.numero}): é a única conversa que casa com o WhatsApp do contato responsável.` : null);
      }
      if (res.envio_recusado_pelo_modo_teste) {
        setErro("Modo teste: só pedidos do cliente #14 podem ser avisados. A lista é só para consulta.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [idInt, inicial]);

  const podeEnviar = Boolean(onEnviar) && !erro;
  const quantas = (s: SelecaoConversas) => ("todas" in s ? (conversas?.length ?? 0) : s.chatIds.length);
  const nomes = (s: SelecaoConversas) =>
    ("todas" in s ? (conversas ?? []) : (conversas ?? []).filter((c) => s.chatIds.includes(c.chat_id)))
      .map((c) => `${c.nome} (${c.numero})`)
      .join(", ");
  const botao = "rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-100">
            <MessageCircle className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={ocupado}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-6 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs text-slate-500 dark:text-slate-400">Conversas do cliente do pedido {idInt} no ChatGuru (remetente 3478).</p>
          {nota && <p>{nota}</p>}
          {erro && <p className="text-red-700 dark:text-red-300">{erro}</p>}
          {conversas === null ? (
            <p>Lendo as conversas...</p>
          ) : conversas.length === 0 ? (
            !nota && !erro && <p>Cliente sem conversa no ChatGuru (remetente 3478)</p>
          ) : (
            <ListaConversas
              conversas={conversas}
              selecionadas={selecionadas}
              onChange={setSelecionadas}
              onEnviarUma={podeEnviar ? (id) => setConfirmando({ chatIds: [id] }) : undefined}
              disabled={ocupado || Boolean(confirmando)}
            />
          )}
          {confirmando && (
            <div className="rounded-xl border border-slate-300 p-3 dark:border-slate-600">
              <p className="font-semibold text-slate-950 dark:text-slate-100">
                Enviar para {quantas(confirmando) === 1 ? "esta conversa" : `${quantas(confirmando)} conversas`}?
              </p>
              <p className="mt-1">{nomes(confirmando)}</p>
              {descricaoEnvio && <p className="mt-1">{descricaoEnvio}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmando(null)}
                  className={`${botao} border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => onEnviar?.(confirmando)}
                  className={`${botao} bg-[#0b2f4a] text-white hover:bg-[#123f61]`}
                >
                  {ocupado ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
          {podeEnviar && conversas && conversas.length > 0 && !confirmando && (
            <>
              {conversas.length > 1 && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmando({ todas: true })}
                  className={`${botao} border border-[#0b2f4a] bg-white text-[#0b2f4a] hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100`}
                >
                  Enviar para todas
                </button>
              )}
              <button
                type="button"
                disabled={ocupado || selecionadas.length === 0}
                onClick={() => setConfirmando({ chatIds: selecionadas })}
                className={`${botao} bg-[#0b2f4a] text-white hover:bg-[#123f61]`}
              >
                Enviar para as marcadas{selecionadas.length ? ` (${selecionadas.length})` : ""}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={ocupado}
            className={`${botao} bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100`}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
