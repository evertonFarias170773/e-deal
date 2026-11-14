"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle } from "lucide-react";
import { arteJaEnviada } from "@/features/orcamentos/lib/comprador-da-arte";
import {
  escolhaDeContatos,
  numeroParaExibir,
  situacaoDaConversa,
  type ContatoEscolhido,
  type ConversaWhatsapp,
  type SituacaoDaConversa
} from "@/features/orcamentos/lib/conversa-whatsapp";
import {
  carregarConversasDaProposta,
  gravarContatosDaProposta,
  type EscolhaGravada
} from "@/features/orcamentos/services/conversa-whatsapp.client";

/**
 * Conversa do WhatsApp (ChatGuru) da proposta: o Comprador da aba Artes e o bloco
 * "Conversa do WhatsApp" da aba Geral são a mesma escolha (10/11 e 11/11/2026).
 *
 * Decisão do Everton: a visão do Guru (chatguru_contatos_3478) é só para falar com
 * o cliente pelo WhatsApp; a tabela contatos é o cadastro da pessoa e não muda
 * aqui. O bloco lista as conversas do cliente (codigo_cliente = id_cliente) com o
 * nome da conversa e o número; a escolha fica em `propostas.chatguru_chat_id`,
 * gravada pela rota /api/orcamentos/conversa-whatsapp, que confere se a conversa é
 * do cliente. Não se cadastra nem se edita conversa pelo Vibe: só se escolhe.
 *
 * Proposta nova (ou cliente trocado e ainda não salvo): a escolha fica guardada na
 * tela e é gravada no Salvar (`gravarAoSalvar`), pela mesma rota. Com uma conversa
 * só, ela já vem escolhida e também é gravada no Salvar.
 *
 * O hook vive na página da proposta, para as duas abas mostrarem a mesma escolha.
 * Regra em lib/conversa-whatsapp.
 */

type Resultado = { ok: boolean; erro?: string };

export type ConversaDaArte = {
  carregando: boolean;
  erro: string | null;
  /** Regra do Comprador (a principal): a mesma de antes, lib/conversa-whatsapp. */
  situacao: SituacaoDaConversa;
  /** A principal gravada na proposta. */
  gravada: ConversaWhatsapp | null;
  /** A escolha da tela ainda não está gravada: vai no Salvar da proposta. */
  pendente: boolean;
  jaEnviada: boolean;
  /**
   * Contatos do pedido (14/11/2026): as conversas escolhidas, a principal primeiro.
   * Com uma conversa só no cliente e nada escolhido, ela vem como principal (a gravar).
   */
  contatos: ContatoEscolhido[];
  /** Torna a conversa principal (Comprador); entra nos contatos se não estava. */
  escolher: (chatId: string) => Promise<Resultado>;
  /** Liga ou desliga a conversa nos contatos do pedido (aba Geral). */
  alternar: (chatId: string) => Promise<Resultado>;
  /** Grava a escolhida (a única do cliente ou a marcada) se a proposta ainda não a tem. */
  gravarEscolhaSeFaltar: () => Promise<Resultado>;
  /** Depois do Salvar: grava a escolha na proposta salva (nova ou com cliente trocado). */
  gravarAoSalvar: (idInt: number) => Promise<Resultado>;
};

const clienteNumerico = (id: string | null) => (id && /^\d+$/.test(id) ? id : null);

type Marcacao = { cliente: string; chatIds: string[]; principal: string };

export function useConversaDaArte(idInt: number | null, idClienteTela: string | null): ConversaDaArte {
  const idCliente = clienteNumerico(idClienteTela);
  // Recarrega quando muda a proposta ou o cliente da tela.
  const chave = `${idInt ?? ""}|${idCliente ?? ""}`;
  const [carregadoPara, setCarregadoPara] = useState<string | null>(null);
  const [clienteCarregado, setClienteCarregado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conversas, setConversas] = useState<ConversaWhatsapp[]>([]);
  const [gravadas, setGravadas] = useState<EscolhaGravada[]>([]);
  const [clienteDaProposta, setClienteDaProposta] = useState(false);
  const [statusArte, setStatusArte] = useState<string | null>(null);
  // Escolha feita na tela e ainda não gravada, presa ao cliente em que foi feita.
  const [marcada, setMarcada] = useState<Marcacao | null>(null);
  const vaiCarregar = Boolean(idInt || idCliente);
  // Recarga do mesmo cliente (ex.: a proposta nova acabou de ganhar número) não esconde a lista.
  const carregando = vaiCarregar && carregadoPara !== chave && clienteCarregado !== idCliente;

  useEffect(() => {
    let vivo = true;
    if (!idInt && !idCliente) return;
    carregarConversasDaProposta(idInt, idCliente).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setConversas(r.dados.conversas);
        setGravadas(r.dados.escolhidas);
        setClienteDaProposta(r.dados.clienteDaProposta);
        setStatusArte(r.dados.statusArte);
        setErro(null);
      } else {
        setConversas([]);
        setErro(r.erro);
      }
      setClienteCarregado(idCliente);
      setCarregadoPara(chave);
    });
    return () => {
      vivo = false;
    };
  }, [idInt, idCliente, chave]);

  const listaValida = vaiCarregar && clienteCarregado === idCliente;
  const marcadaAqui = marcada && marcada.cliente === idCliente ? marcada : null;
  const gravadasAqui = useMemo(() => (clienteDaProposta ? gravadas : []), [clienteDaProposta, gravadas]);
  const principalGravada = gravadasAqui.find((g) => g.principal)?.chat_id ?? null;
  const situacao = useMemo(
    () => situacaoDaConversa(listaValida ? conversas : [], marcadaAqui?.principal ?? principalGravada),
    [listaValida, conversas, marcadaAqui, principalGravada]
  );
  const gravada = useMemo(
    () => (listaValida && principalGravada ? conversas.find((c) => c.chat_id === principalGravada) ?? null : null),
    [listaValida, conversas, principalGravada]
  );

  // O conjunto que a tela mostra: o marcado, senão o gravado, senão a única conversa.
  const conjunto = useMemo((): { chatIds: string[]; principal: string | null } => {
    if (marcadaAqui) return { chatIds: marcadaAqui.chatIds, principal: marcadaAqui.principal };
    if (gravadasAqui.length > 0) return { chatIds: gravadasAqui.map((g) => g.chat_id), principal: principalGravada };
    if (situacao.escolhida) return { chatIds: [situacao.escolhida.chat_id], principal: situacao.escolhida.chat_id };
    return { chatIds: [], principal: null };
  }, [marcadaAqui, gravadasAqui, principalGravada, situacao.escolhida]);
  const contatos = useMemo(() => {
    if (!listaValida) return [];
    const lista = conjunto.chatIds
      .map((id) => conversas.find((c) => c.chat_id === id))
      .filter((c): c is ConversaWhatsapp => Boolean(c))
      .map((c) => ({ ...c, principal: c.chat_id === conjunto.principal }));
    return lista.sort((a, b) => Number(b.principal) - Number(a.principal));
  }, [listaValida, conjunto, conversas]);

  const gravadoIgual =
    gravadasAqui.length === conjunto.chatIds.length &&
    conjunto.chatIds.every((id) => gravadasAqui.some((g) => g.chat_id === id)) &&
    principalGravada === conjunto.principal;
  const pendente = contatos.length > 0 && !gravadoIgual;
  const podeGravarJa = Boolean(idInt && clienteDaProposta);

  const gravarConjunto = useCallback(async (id: number, chatIds: string[], principal: string): Promise<Resultado> => {
    const escolha = escolhaDeContatos(chatIds, principal);
    if (!escolha) return { ok: false, erro: "Escolha pelo menos uma conversa do ChatGuru." };
    const r = await gravarContatosDaProposta(id, escolha.chatIds, escolha.principal);
    if (!r.ok) return { ok: false, erro: r.erro };
    setGravadas(escolha.chatIds.map((c) => ({ chat_id: c, principal: c === escolha.principal })));
    setClienteDaProposta(true);
    setMarcada(null);
    return { ok: true };
  }, []);

  /** Aplica a nova escolha: grava já (proposta salva) ou guarda para o Salvar. */
  const aplicar = useCallback(
    async (chatIds: string[], principal: string): Promise<Resultado> => {
      const escolha = escolhaDeContatos(chatIds, principal);
      if (!escolha) return { ok: false, erro: "Deixe pelo menos uma conversa do ChatGuru no pedido." };
      if (podeGravarJa && idInt) return gravarConjunto(idInt, escolha.chatIds, escolha.principal);
      if (!idCliente) return { ok: false, erro: "Escolha o cliente antes." };
      setMarcada({ cliente: idCliente, chatIds: escolha.chatIds, principal: escolha.principal });
      return { ok: true };
    },
    [podeGravarJa, idInt, idCliente, gravarConjunto]
  );

  const escolher = useCallback(
    (chatId: string) => aplicar(conjunto.chatIds.includes(chatId) ? conjunto.chatIds : [...conjunto.chatIds, chatId], chatId),
    [aplicar, conjunto]
  );

  const alternar = useCallback(
    (chatId: string) => {
      const tem = conjunto.chatIds.includes(chatId);
      const proximos = tem ? conjunto.chatIds.filter((c) => c !== chatId) : [...conjunto.chatIds, chatId];
      const principal = conjunto.principal && proximos.includes(conjunto.principal) ? conjunto.principal : proximos[0] ?? "";
      return aplicar(proximos, principal);
    },
    [aplicar, conjunto]
  );

  const gravarAoSalvar = useCallback(
    async (idSalvo: number): Promise<Resultado> => {
      if (conjunto.chatIds.length === 0 || !conjunto.principal || !Number.isInteger(idSalvo) || idSalvo <= 0) return { ok: true };
      if (podeGravarJa && idSalvo === idInt && gravadoIgual) return { ok: true };
      return gravarConjunto(idSalvo, conjunto.chatIds, conjunto.principal);
    },
    [conjunto, podeGravarJa, idInt, gravadoIgual, gravarConjunto]
  );

  const gravarEscolhaSeFaltar = useCallback(async (): Promise<Resultado> => {
    if (!idInt) return { ok: false, erro: "Salve a proposta antes." };
    return gravarAoSalvar(idInt);
  }, [idInt, gravarAoSalvar]);

  return {
    carregando,
    erro,
    situacao,
    gravada,
    pendente,
    jaEnviada: arteJaEnviada(statusArte),
    contatos,
    escolher,
    alternar,
    gravarEscolhaSeFaltar,
    gravarAoSalvar
  };
}

interface ListaDeConversasProps {
  conversa: ConversaDaArte;
  idCliente: string | null;
  onAviso: (tipo: "success" | "error" | "warning", titulo: string, descricao?: string) => void;
  /** "geral": bloco da aba Geral; "artes": Comprador (com a regra do Enviar para arte). */
  onde: "geral" | "artes";
}

/** A lista das conversas do cliente para escolher, com o que falta. Mesma escolha nas duas abas. */
export function ListaDeConversas({ conversa, idCliente, onAviso, onde }: ListaDeConversasProps) {
  const { carregando, erro, situacao, jaEnviada, pendente } = conversa;
  const [gravando, setGravando] = useState(false);
  const escolhida = situacao.escolhida;

  const escolher = async (chatId: string) => {
    if (gravando || (chatId === escolhida?.chat_id && !pendente)) return;
    setGravando(true);
    const r = await conversa.escolher(chatId);
    setGravando(false);
    if (!r.ok) onAviso("error", "Não foi possível gravar a conversa", r.erro);
  };

  if (!clienteNumerico(idCliente)) {
    return <p className="text-sm text-amber-700">Proposta sem cliente cadastrado: não há conversa para escolher.</p>;
  }
  if (carregando) return <p className="text-sm text-slate-500">Lendo as conversas do cliente no ChatGuru...</p>;
  if (erro) return <p className="text-sm text-red-600">{erro}</p>;

  const avisoGeral = situacao.semConversa
    ? null
    : situacao.precisaEscolher
      ? `O cliente tem ${situacao.conversas.length} conversas no ChatGuru. Escolha qual é a do cliente.`
      : situacao.aviso;

  return (
    <div className="space-y-3" data-conversas-whatsapp={onde}>
      {situacao.conversas.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {situacao.conversas.map((c) => {
            const marcada = escolhida?.chat_id === c.chat_id;
            return (
              <li key={c.chat_id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                    marcada ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <input
                    type="radio"
                    name={`conversa-whatsapp-${onde}`}
                    checked={marcada}
                    disabled={gravando}
                    onChange={() => void escolher(c.chat_id)}
                    // Já marcada e ainda não gravada (a única conversa): o clique grava.
                    onClick={() => {
                      if (marcada && pendente) void escolher(c.chat_id);
                    }}
                  />
                  <MessageCircle size={14} className="shrink-0 text-emerald-700" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{c.nome}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{numeroParaExibir(c.numero)}</span>
                  </span>
                  {marcada && (
                    <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                      {pendente ? (situacao.gravada ? "escolhida" : "única conversa") : "gravada"}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {onde === "geral" && situacao.semConversa && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Cliente sem conversa no ChatGuru.</span> Peça ao atendimento para abrir a conversa com o
            código do cliente no nome; depois reabra a proposta.
          </span>
        </div>
      )}
      {onde === "geral" && avisoGeral && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {avisoGeral}
        </p>
      )}
      {onde === "artes" && situacao.aviso && !jaEnviada && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {situacao.aviso}
        </p>
      )}
      {pendente && escolhida && (
        <p className="text-xs text-slate-500 dark:text-slate-400">A conversa marcada é gravada ao salvar a proposta.</p>
      )}
      {onde === "artes" && situacao.liberado && !jaEnviada && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={14} /> Comprador pronto para o envio.
        </p>
      )}
      {onde === "artes" && jaEnviada && (
        <p className="text-xs text-slate-500">Pedido já enviado para arte: a exigência do Comprador vale só para o primeiro envio.</p>
      )}
    </div>
  );
}

interface ContatosDoPedidoProps {
  conversa: ConversaDaArte;
  idCliente: string | null;
  onAviso: (tipo: "success" | "error" | "warning", titulo: string, descricao?: string) => void;
  /** Herdado do pedido principal (complemento): só leitura. */
  somenteLeitura?: boolean;
}

/**
 * CONTATOS DO PEDIDO, aba Geral (14/11/2026, decisão da diretoria): uma ou mais
 * conversas do ChatGuru do cliente, uma delas a principal (o Comprador da aba
 * Artes). Substitui a lista da tabela contatos.
 */
export function ContatosDoPedido({ conversa, idCliente, onAviso, somenteLeitura }: ContatosDoPedidoProps) {
  const { carregando, erro, situacao, contatos, pendente } = conversa;
  const [gravando, setGravando] = useState(false);

  const agir = async (acao: () => Promise<Resultado>, falha: string) => {
    if (gravando || somenteLeitura) return;
    setGravando(true);
    const r = await acao();
    setGravando(false);
    if (!r.ok) onAviso("error", falha, r.erro);
  };

  if (!clienteNumerico(idCliente)) {
    return <p className="text-sm text-amber-700">Proposta sem cliente cadastrado: não há conversa para escolher.</p>;
  }
  if (carregando) return <p className="text-sm text-slate-500">Lendo as conversas do cliente no ChatGuru...</p>;
  if (erro) return <p className="text-sm text-red-600">{erro}</p>;

  if (situacao.semConversa) {
    return (
      <div className="flex items-start gap-1.5 text-xs text-amber-700" data-contatos-do-pedido="sem-conversa">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Cadastre a conversa no ChatGuru.</span> O cliente não tem conversa no WhatsApp da Ideal. Peça ao
          atendimento para abrir a conversa com o código do cliente no nome; depois reabra a proposta. Sem conversa, o pedido não vai para
          arte nem para produção.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-contatos-do-pedido="lista">
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {situacao.conversas.map((c) => {
          const escolhido = contatos.find((x) => x.chat_id === c.chat_id);
          return (
            <li key={c.chat_id} className={`flex items-center gap-3 px-3 py-2 text-sm ${escolhido ? "bg-emerald-50/60 dark:bg-emerald-950/30" : ""}`}>
              <input
                type="checkbox"
                aria-label={`Contato do pedido: ${c.nome}`}
                checked={Boolean(escolhido)}
                disabled={gravando || somenteLeitura}
                onChange={() => void agir(() => conversa.alternar(c.chat_id), "Não foi possível gravar os contatos do pedido")}
              />
              <MessageCircle size={14} className="shrink-0 text-emerald-700" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{c.nome}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{numeroParaExibir(c.numero)}</span>
              </span>
              {escolhido?.principal ? (
                <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white" data-principal>
                  Principal · Comprador
                </span>
              ) : escolhido ? (
                <button
                  type="button"
                  disabled={gravando || somenteLeitura}
                  onClick={() => void agir(() => conversa.escolher(c.chat_id), "Não foi possível trocar o contato principal")}
                  className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-200"
                >
                  Tornar principal
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {contatos.length === 0 && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Marque pelo menos uma conversa: sem contato escolhido, o pedido não vai
          para arte nem para produção.
        </p>
      )}
      {situacao.liberado === false && contatos.length > 0 && situacao.aviso && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {situacao.aviso}
        </p>
      )}
      {pendente && <p className="text-xs text-slate-500 dark:text-slate-400">A escolha é gravada ao salvar a proposta.</p>}
    </div>
  );
}

interface ArtesCompradorCardProps {
  conversa: ConversaDaArte;
  idCliente: string | null;
  onAviso: (tipo: "success" | "error" | "warning", titulo: string, descricao?: string) => void;
}

export function ArtesCompradorCard({ conversa, idCliente, onAviso }: ArtesCompradorCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-800">Comprador do cliente</p>
      <p className="text-xs text-slate-500">
        Quem recebe a arte: uma conversa do cliente no WhatsApp da Ideal (ChatGuru). É a mesma escolha do bloco Conversa do WhatsApp
        da aba Geral.
      </p>
      <div className="mt-4">
        <ListaDeConversas conversa={conversa} idCliente={idCliente} onAviso={onAviso} onde="artes" />
      </div>
    </div>
  );
}
