"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle } from "lucide-react";
import { arteJaEnviada } from "@/features/orcamentos/lib/comprador-da-arte";
import {
  numeroParaExibir,
  situacaoDaConversa,
  type ConversaWhatsapp,
  type SituacaoDaConversa
} from "@/features/orcamentos/lib/conversa-whatsapp";
import { carregarConversasDaProposta, gravarConversaDaProposta } from "@/features/orcamentos/services/conversa-whatsapp.client";

/**
 * Comprador da aba Artes = conversa do WhatsApp (ChatGuru) do cliente (10/11/2026).
 *
 * Decisão do Everton: a visão do Guru (chatguru_contatos_3478) é só para falar com
 * o cliente pelo WhatsApp; a tabela contatos é o cadastro da pessoa e não muda
 * aqui. O bloco lista as conversas do cliente (codigo_cliente = id_cliente) com o
 * nome da conversa e o número; a escolha fica em `propostas.chatguru_chat_id`,
 * gravada pela rota /api/orcamentos/conversa-whatsapp. Não se cadastra conversa
 * pelo Vibe: saíram o "Adicionar Comprador" e o "Usar como Comprador".
 *
 * O hook vive na página da proposta, para a aba Geral mostrar a conversa escolhida.
 * Regra em lib/conversa-whatsapp.
 */

export type ConversaDaArte = {
  carregando: boolean;
  erro: string | null;
  situacao: SituacaoDaConversa;
  /** A conversa gravada na proposta (a que a aba Geral mostra). */
  gravada: ConversaWhatsapp | null;
  jaEnviada: boolean;
  escolher: (chatId: string) => Promise<{ ok: boolean; erro?: string }>;
  /** Grava a conversa da tela (a única do cliente) se a proposta ainda não a tem. */
  gravarEscolhaSeFaltar: () => Promise<{ ok: boolean; erro?: string }>;
};

export function useConversaDaArte(idInt: number | null, idCliente: string | null): ConversaDaArte {
  // Recarrega quando muda a proposta ou o cliente (a rota lê o cliente gravado).
  const chave = `${idInt ?? ""}|${idCliente ?? ""}`;
  const [carregadoPara, setCarregadoPara] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conversas, setConversas] = useState<ConversaWhatsapp[]>([]);
  const [chatIdGravado, setChatIdGravado] = useState<string | null>(null);
  const [statusArte, setStatusArte] = useState<string | null>(null);
  const carregando = Boolean(idInt) && carregadoPara !== chave;

  useEffect(() => {
    let vivo = true;
    if (!idInt) return;
    carregarConversasDaProposta(idInt).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setConversas(r.dados.conversas);
        setChatIdGravado(r.dados.chatIdGravado);
        setStatusArte(r.dados.statusArte);
        setErro(null);
      } else {
        setErro(r.erro);
      }
      setCarregadoPara(chave);
    });
    return () => {
      vivo = false;
    };
  }, [idInt, chave]);

  const situacao = useMemo(() => situacaoDaConversa(conversas, chatIdGravado), [conversas, chatIdGravado]);
  const gravada = useMemo(() => conversas.find((c) => c.chat_id === chatIdGravado) ?? null, [conversas, chatIdGravado]);

  const escolher = useCallback(
    async (chatId: string) => {
      if (!idInt) return { ok: false, erro: "Salve a proposta antes." };
      const r = await gravarConversaDaProposta(idInt, chatId);
      if (!r.ok) return { ok: false, erro: r.erro };
      setChatIdGravado(chatId);
      return { ok: true };
    },
    [idInt]
  );

  const gravarEscolhaSeFaltar = useCallback(async () => {
    const e = situacao.escolhida;
    if (!e || situacao.gravada) return { ok: true };
    return escolher(e.chat_id);
  }, [situacao.escolhida, situacao.gravada, escolher]);

  return { carregando, erro, situacao, gravada, jaEnviada: arteJaEnviada(statusArte), escolher, gravarEscolhaSeFaltar };
}

interface ArtesCompradorCardProps {
  conversa: ConversaDaArte;
  idCliente: string | null;
  onAviso: (tipo: "success" | "error" | "warning", titulo: string, descricao?: string) => void;
}

export function ArtesCompradorCard({ conversa, idCliente, onAviso }: ArtesCompradorCardProps) {
  const { carregando, erro, situacao, jaEnviada } = conversa;
  const [gravando, setGravando] = useState(false);
  const clienteCadastrado = Boolean(idCliente && /^\d+$/.test(idCliente));
  const escolhida = situacao.escolhida;

  const escolher = async (chatId: string) => {
    if (gravando || (chatId === escolhida?.chat_id && situacao.gravada)) return;
    setGravando(true);
    const r = await conversa.escolher(chatId);
    setGravando(false);
    if (!r.ok) onAviso("error", "Não foi possível gravar a conversa", r.erro);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-800">Comprador do cliente</p>
      <p className="text-xs text-slate-500">
        Quem recebe a arte: uma conversa do cliente no WhatsApp da Ideal (ChatGuru). A conversa é aberta pelo atendimento, com o código do cliente no nome.
      </p>

      <div className="mt-4 space-y-3">
        {carregando ? (
          <p className="text-sm text-slate-500">Lendo as conversas do cliente no ChatGuru...</p>
        ) : erro ? (
          <p className="text-sm text-red-600">{erro}</p>
        ) : !clienteCadastrado ? (
          <p className="text-sm text-amber-700">Proposta sem cliente cadastrado: não há conversa para escolher.</p>
        ) : (
          <>
            {situacao.conversas.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {situacao.conversas.map((c) => {
                  const marcada = escolhida?.chat_id === c.chat_id;
                  return (
                    <li key={c.chat_id}>
                      <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${marcada ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                        <input
                          type="radio"
                          name="conversa-da-arte"
                          checked={marcada}
                          disabled={gravando}
                          onChange={() => void escolher(c.chat_id)}
                          // Única conversa já marcada e ainda não gravada: o clique nela grava.
                          onClick={() => {
                            if (marcada && !situacao.gravada) void escolher(c.chat_id);
                          }}
                        />
                        <MessageCircle size={14} className="shrink-0 text-emerald-700" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800">{c.nome}</span>
                          <span className="block text-xs text-slate-500">{numeroParaExibir(c.numero)}</span>
                        </span>
                        {marcada && <span className="text-[11px] font-semibold text-indigo-700">{situacao.gravada ? "escolhida" : "única conversa"}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {situacao.aviso && !jaEnviada && (
              <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {situacao.aviso}
              </p>
            )}
            {situacao.liberado && !jaEnviada && (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} /> Comprador pronto para o envio.
              </p>
            )}
            {jaEnviada && (
              <p className="text-xs text-slate-500">Pedido já enviado para arte: a exigência do Comprador vale só para o primeiro envio.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
