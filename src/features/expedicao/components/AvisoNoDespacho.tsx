"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { formatDateTime } from "@/lib/formatters/date";
import { ListaConversas, MOTIVO_ESCOLHA } from "./ConversasDoCliente";
import {
  ROTULO_ESTADO_AVISO,
  TEXTO_HOMOLOGACAO,
  enviarAvisoPronto,
  prepararAvisoPronto,
  reenviarAvisoPronto,
  travaCompartilhadaPresa,
  type AvisoPronto,
  type DespachoParaAviso,
  type RecusaPorNumero
} from "../services/aviso-pronto.client";

/**
 * Aviso "pedido pronto" no "Confirmar despacho" (10/11/2026, v23 da função).
 *
 * Antes era um botão na frente do card. Agora a janela do despacho tem a caixa
 * "Avisar o cliente pelo WhatsApp", já marcada, com a conversa e o modelo (lidos
 * pela acao "preparar" com a forma de envio que está na tela, sem gravar nada).
 * O despacho é gravado primeiro; o aviso sai logo depois. Aviso que falha não
 * desfaz o despacho: a janela mostra o motivo e o reenvio fica no menu ⋯ do card
 * ("Avisar cliente"). "Salvar sem despachar" não envia nada.
 *
 * Não enviar duas vezes: pedido que já recebeu o aviso abre com a caixa
 * desmarcada e a data do aviso anterior; marcar de novo é um reenvio. Aviso em
 * andamento ou em resultado desconhecido deixa a caixa apagada (conferir no
 * ChatGuru antes, pelo menu).
 */

/** Estados em que o cliente já recebeu (ou está recebendo) a mensagem. */
const JA_RECEBEU = new Set(["executado", "enviado", "aguardando"]);

type Preparo = {
  ok: boolean;
  mensagem?: string;
  aviso: AvisoPronto | null;
  dialogo: string | null;
  /** Motivo de o aviso não sair (modelo, contato, conversa, modo teste). */
  bloqueio: string | null;
  conversa: { chat_id: string; nome: string; numero: string } | null;
  escolha: { motivo: "varias" | "nenhuma"; conversas: { chat_id: string; nome: string; numero: string }[] } | null;
  homologacao: boolean;
};

export type ResultadoAvisoDespacho = { ok: boolean; titulo: string; texto: string };

export function useAvisoNoDespacho({
  idInt,
  despacho,
  ativo,
  onAviso
}: {
  idInt: number;
  despacho: DespachoParaAviso;
  /** Só no despacho (não na edição) e só para quem opera a Expedição. */
  ativo: boolean;
  onAviso?: (idInt: number, aviso: AvisoPronto | null | undefined, modoTeste?: boolean, recusa?: RecusaPorNumero | null) => void;
}) {
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  // Forma de envio a que o preparo responde: diferente da tela = ainda conferindo.
  const [chaveDoPreparo, setChaveDoPreparo] = useState<string | null>(null);
  // null = o usuário não mexeu: vale o padrão do preparo.
  const [escolhaDoUsuario, setEscolhaDoUsuario] = useState<boolean | null>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const geracao = useRef(0);
  const chave = JSON.stringify(despacho);

  useEffect(() => {
    if (!ativo) return;
    const minha = ++geracao.current;
    const t = setTimeout(() => {
      void (async () => {
        const res = await prepararAvisoPronto(idInt, JSON.parse(chave) as DespachoParaAviso);
        if (minha !== geracao.current) return;
        setChaveDoPreparo(chave);
        if (!res.ok) {
          setPreparo({ ok: false, mensagem: res.mensagem, aviso: null, dialogo: null, bloqueio: null, conversa: null, escolha: null, homologacao: false });
          return;
        }
        setPreparo({
          ok: true,
          aviso: res.aviso ?? null,
          dialogo: res.modelo?.dialogo ?? null,
          bloqueio: res.modelo?.bloqueio ?? res.bloqueio ?? null,
          conversa: res.conversa ?? null,
          escolha: res.escolha ?? null,
          homologacao: res.homologacao === true
        });
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [idInt, chave, ativo]);

  const carregando = ativo && chaveDoPreparo !== chave;
  const anterior = preparo?.aviso ?? null;
  const emAndamento = anterior?.estado === "preparando";
  const travado = (anterior?.estado === "desconhecido" && anterior.trava_conversa === true) || travaCompartilhadaPresa(anterior);
  const incerto = anterior?.estado === "desconhecido";
  const jaRecebeu = Boolean(anterior && JA_RECEBEU.has(anterior.estado));
  const podeEnviar = Boolean(preparo?.ok && preparo.dialogo && !preparo.bloqueio && !emAndamento && !travado && !incerto);
  const padrao = podeEnviar && !jaRecebeu;
  const marcado = podeEnviar && (escolhaDoUsuario ?? padrao);
  const precisaEscolher = Boolean(marcado && preparo?.escolha);

  /** Por que o Confirmar despacho não pode seguir com a caixa marcada (null = pode). */
  function pendenciaAntesDeConfirmar(): string | null {
    if (!ativo || !marcado) return null;
    if (carregando) return "Ainda conferindo o aviso do WhatsApp. Espere um instante ou desmarque a caixa.";
    if (precisaEscolher && selecionadas.length === 0) return "Escolha a conversa do aviso ou desmarque a caixa.";
    return null;
  }

  /** Depois do despacho gravado. null = a caixa estava desmarcada (nada enviado). */
  async function enviarDepoisDoDespacho(): Promise<ResultadoAvisoDespacho | null> {
    if (!ativo || !marcado || !preparo) return null;
    const selecao = preparo.escolha ? { chatIds: selecionadas } : undefined;
    const res = anterior ? await reenviarAvisoPronto(idInt, anterior.seq, selecao) : await enviarAvisoPronto(idInt, selecao);
    if (res.ok && !res.escolha) onAviso?.(idInt, res.aviso, res.modo_teste, res.ja_existia ? undefined : (res.recusa_numero ?? null));
    const naoSaiu = "O despacho continua confirmado. O reenvio fica no menu ⋯ do card, em Avisar cliente.";
    if (!res.ok) return { ok: false, titulo: "O aviso não saiu", texto: `${res.mensagem ?? "Erro ao falar com o ChatGuru."} ${naoSaiu}` };
    if (res.escolha) {
      return {
        ok: false,
        titulo: "O aviso não saiu",
        texto: `As conversas do cliente no ChatGuru mudaram e é preciso escolher de novo. Nada foi enviado. ${naoSaiu}`
      };
    }
    if (res.ja_existia) {
      return { ok: false, titulo: "O aviso não foi enviado de novo", texto: `Este pedido já tinha aviso. ${naoSaiu}` };
    }
    if (res.envios && res.envios.length > 1) {
      const ok = res.envios.filter((e) => e.aviso?.estado === "executado").length;
      const resumo = res.envios
        .map((e) => `${e.nome}: ${e.recusa ? "não enviado" : e.aviso ? (ROTULO_ESTADO_AVISO[e.aviso.estado] ?? e.aviso.estado) : "—"}`)
        .join("; ");
      return ok === res.envios.length
        ? { ok: true, titulo: "Aviso enviado", texto: `${ok} conversas: ${resumo}.` }
        : { ok: false, titulo: `Aviso em ${ok} de ${res.envios.length} conversas`, texto: `${resumo}. ${naoSaiu}` };
    }
    const a = res.aviso;
    const modelo = a?.dialogo ? `diálogo ${a.dialogo}` : "aviso";
    if (a && JA_RECEBEU.has(a.estado)) {
      return {
        ok: true,
        titulo: a.homologacao ? "Homologação enviada" : "Aviso enviado ao cliente",
        texto: a.homologacao ? `Pedido ${idInt}: ${modelo} na conversa de teste do Edison.` : `Pedido ${idInt}: ${modelo}, ${ROTULO_ESTADO_AVISO[a.estado]}.`
      };
    }
    if (a?.estado === "falhou") {
      const numero = res.recusa_numero ? ` Número usado: ${res.recusa_numero.numero_enviado}.` : "";
      return {
        ok: false,
        titulo: "O ChatGuru recusou o aviso",
        texto: `${res.motivo_chatguru ? `ChatGuru: ${res.motivo_chatguru}` : "Nada saiu."}${numero} ${naoSaiu}`
      };
    }
    return {
      ok: false,
      titulo: "Resultado desconhecido do aviso",
      texto: `Não dá para saber se a mensagem saiu. Confira no ChatGuru antes de reenviar. ${naoSaiu}`
    };
  }

  return {
    preparo,
    carregando,
    anterior,
    jaRecebeu,
    emAndamento,
    travado: travado || incerto,
    podeEnviar,
    marcado,
    marcar: (v: boolean) => setEscolhaDoUsuario(v),
    selecionadas,
    setSelecionadas,
    pendenciaAntesDeConfirmar,
    enviarDepoisDoDespacho
  };
}

export function CaixaAvisoNoDespacho({ aviso, ocupado }: { aviso: ReturnType<typeof useAvisoNoDespacho>; ocupado: boolean }) {
  const p = aviso.preparo;
  const a = aviso.anterior;
  return (
    <div className="mx-5 mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-slate-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-slate-300">
      <label className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        <input
          type="checkbox"
          checked={aviso.marcado}
          disabled={ocupado || !aviso.podeEnviar}
          onChange={(e) => aviso.marcar(e.target.checked)}
        />
        <MessageCircle className="h-4 w-4" />
        Avisar o cliente pelo WhatsApp
      </label>
      <div className="mt-1.5 space-y-1 pl-6">
        {aviso.carregando && !p ? (
          <p>Conferindo o aviso...</p>
        ) : !p ? null : !p.ok ? (
          <p className="text-red-700 dark:text-red-300">
            Não foi possível conferir o aviso: {p.mensagem ?? "erro"}. O despacho pode ser confirmado; o aviso fica no menu ⋯ do card, em Avisar cliente.
          </p>
        ) : (
          <>
            {p.dialogo && (
              <p>
                Modelo: <strong>{p.dialogo}</strong>
                {p.conversa && (
                  <>
                    {" "}· vai para <strong>{p.conversa.nome}</strong> ({p.conversa.numero})
                  </>
                )}
              </p>
            )}
            {p.homologacao && <p className="font-semibold text-sky-800 dark:text-sky-200">{TEXTO_HOMOLOGACAO}</p>}
            {p.bloqueio && (
              <p className="text-amber-800 dark:text-amber-200">
                O aviso não vai sair: {p.bloqueio} O despacho pode ser confirmado; o aviso fica no menu ⋯ do card, em Avisar cliente.
              </p>
            )}
            {a && (
              <p className={aviso.jaRecebeu ? "text-slate-600 dark:text-slate-300" : "text-amber-800 dark:text-amber-200"}>
                {aviso.jaRecebeu ? "Este pedido já recebeu o aviso" : "Última tentativa de aviso"} em {formatDateTime(a.criado_em)} por{" "}
                {a.autor_nome || "—"}: {ROTULO_ESTADO_AVISO[a.estado] ?? a.estado}
                {a.dialogo ? ` · ${a.dialogo}` : ""}.
                {aviso.jaRecebeu && " Marque só se quiser mandar de novo."}
                {aviso.travado && " Confira no ChatGuru antes; o reenvio fica no menu ⋯ do card."}
                {aviso.emAndamento && " Há um envio em andamento."}
              </p>
            )}
            {p.escolha && aviso.podeEnviar && (
              <div className="space-y-1.5 pt-1">
                <p>{MOTIVO_ESCOLHA[p.escolha.motivo]}</p>
                <ListaConversas
                  conversas={p.escolha.conversas}
                  selecionadas={aviso.selecionadas}
                  onChange={aviso.setSelecionadas}
                  disabled={ocupado || !aviso.marcado}
                />
              </div>
            )}
          </>
        )}
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          O despacho é confirmado primeiro e o aviso sai logo depois. Se o aviso falhar, o despacho continua valendo. Salvar sem despachar não envia nada.
        </p>
      </div>
    </div>
  );
}

export function ResultadoAvisoNoDespacho({ resultado }: { resultado: ResultadoAvisoDespacho }) {
  return (
    <div
      className={`mx-5 mb-3 rounded-2xl border p-3 text-sm ${
        resultado.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
    >
      <p className="font-semibold">Despacho confirmado. {resultado.titulo}</p>
      <p className="mt-1 text-xs">{resultado.texto}</p>
    </div>
  );
}
