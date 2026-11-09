"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, MessageCircle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDateTime } from "@/lib/formatters/date";
import { liberarPropostaParaProducaoPeloServidor } from "@/features/orcamentos/services/orcamentos.service";
import { liberarComAviso } from "@/features/orcamentos/lib/liberar-com-aviso";
import { ConversasDoClienteModal, ListaConversas, MOTIVO_ESCOLHA } from "@/features/expedicao/components/ConversasDoCliente";
import { LiberarNumeroModal } from "@/features/expedicao/components/LiberarNumeroModal";
import {
  ROTULO_ESTADO_AVISO,
  enviarAvisoProducao,
  liberarNumeroAviso,
  travaCompartilhadaPresa,
  textoDaLiberacao,
  TEXTO_TRAVA_PRESA,
  type RespostaLiberacao,
  prepararAvisoProducao,
  type AvisoPronto,
  type ConversaChatGuru,
  type DiagnosticoChatGuru,
  type EnvioPorConversa,
  type EscolhaConversa,
  type RecusaPorNumero,
  type SelecaoConversas
} from "@/features/expedicao/services/aviso-pronto.client";

type Preparo = {
  destinatario: { id_contato: number; nome: string; whatsapp: string } | null;
  /** Conversa do ChatGuru escolhida pela regra (uma só casou com o WhatsApp do contato). */
  conversa: ConversaChatGuru | null;
  /** A regra não decidiu: a janela pergunta para qual conversa vai. */
  escolha: EscolhaConversa | null;
  bloqueio: string | null;
  modoTeste: boolean;
};

/**
 * "Liberar para Produção" com o aviso "Pedido em Produção" pelo WhatsApp da Ideal
 * (ChatGuru), 07/11/2026. Usado na lista de Pedidos e no menu da proposta.
 *
 * modo "liberar": pergunta se manda a mensagem e mostra para quem vai. "Liberar e
 * enviar" libera exatamente como antes (`liberarPropostaParaProducaoPeloServidor`)
 * e só depois de dar certo envia. "Liberar sem enviar" só libera. "Cancelar" não
 * faz nada. Falha no envio não desfaz a liberação: mostra o motivo e oferece
 * Reenviar, com confirmação.
 *
 * Pedido que já recebeu o aviso (09/11/2026): a janela mostra "Este pedido já
 * recebeu o aviso de produção em {data}" e "Liberar e enviar" manda de novo (é um
 * reenvio, pela tentativa vista). "Liberar sem enviar" segue sem mensagem.
 *
 * Link e bloqueio (09/11/2026): o servidor grava o Link_do_Cliente do próprio pedido
 * antes do diálogo; sem link, "Pedido sem link de aprovação". Fora do modo teste ou
 * do cliente #14, "Envio de aviso de produção em ajuste" e só "Liberar sem enviar".
 *
 * modo "avisar": pedido já liberado. Mostra o último aviso e envia/reenvia.
 *
 * Destino (09/11/2026): a conversa do cliente no ChatGuru (remetente 3478), lida
 * pelo servidor na visão chatguru_contatos_3478. O WhatsApp do contato
 * responsável casou com uma conversa: vai para ela. Casou com várias ou com
 * nenhuma: a janela lista as conversas para marcar (uma, várias ou todas). Sem
 * conversa: "Cliente sem conversa no ChatGuru (remetente 3478)" e não envia.
 * "Ver conversas do cliente" substitui o "Corrigir número"; nada grava em contatos.
 *
 * O envio é o mesmo do aviso de pedido pronto (Edge Function
 * expedicao-pedido-pronto, evento pedido_em_producao): reserva contra duplicidade,
 * trava por conversa, modo teste (só cliente #14) e, para o ADM, "Liberar número"
 * e o diagnóstico do ChatGuru.
 */
export function AvisoProducaoModal({
  idInt,
  modo,
  onClose,
  onConcluido
}: {
  idInt: number;
  modo: "liberar" | "avisar";
  onClose: () => void;
  /** Fecha a janela depois de algo gravado (liberação ou aviso); `liberou` pede atualizar a lista. */
  onConcluido: (liberou: boolean) => void;
}) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const ehAdm = Boolean(user?.isSuperAdmin || user?.isAdmin);

  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const [erroPreparo, setErroPreparo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<AvisoPronto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [liberou, setLiberou] = useState(false);
  const [mostrarResultado, setMostrarResultado] = useState(modo === "avisar");
  const [motivo, setMotivo] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<(RecusaPorNumero & { seq: number }) | null>(null);
  const [envios, setEnvios] = useState<EnvioPorConversa[] | null>(null);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoChatGuru[] | null>(null);
  const [confirmandoReenvio, setConfirmandoReenvio] = useState(false);
  const [liberandoNumero, setLiberandoNumero] = useState(false);
  // Conversas marcadas na própria janela, quando a regra não decidiu.
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  // Janela das conversas: escolha que o servidor pediu ou "Ver conversas do cliente".
  const [conversas, setConversas] = useState<{ reenvio: boolean; inicial: EscolhaConversa | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const res = await prepararAvisoProducao(idInt);
      if (!vivo) return;
      if (!res.ok) {
        const m = res.mensagem ?? "Não foi possível ler o contato do pedido.";
        setErroPreparo(m);
        setPreparo({ destinatario: null, conversa: null, escolha: null, bloqueio: m, modoTeste: true });
        return;
      }
      setPreparo({
        destinatario: res.destinatario ?? null,
        conversa: res.conversa ?? null,
        escolha: res.escolha ?? null,
        bloqueio: res.bloqueio ?? null,
        modoTeste: res.modo_teste !== false
      });
      setAviso(res.aviso ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, [idInt]);

  function fechar() {
    if (ocupado) return;
    if (liberou || aviso) onConcluido(liberou);
    else onClose();
  }

  /** Seleção da própria janela (quando a regra pediu escolha). */
  function selecaoDaJanela(): SelecaoConversas | undefined {
    if (!preparo?.escolha) return undefined;
    return selecionadas.length === preparo.escolha.conversas.length ? { todas: true } : { chatIds: selecionadas };
  }

  async function enviar(reenvio?: { seqAtual: number }, selecao?: SelecaoConversas) {
    setOcupado(true);
    // Erro de rede no aviso não pode prender a janela (09/11/2026): o "ocupado" sempre volta.
    let res: Awaited<ReturnType<typeof enviarAvisoProducao>>;
    try {
      res = await enviarAvisoProducao(idInt, reenvio, selecao);
    } catch (e) {
      res = { ok: false, mensagem: e instanceof Error && e.message ? e.message : "Não foi possível falar com o servidor do aviso." };
    } finally {
      setOcupado(false);
    }
    setConfirmandoReenvio(false);
    setMostrarResultado(true);
    if (res.ok && res.escolha) {
      // A lista mudou desde que a janela abriu (ou faltou escolher): pergunta de novo.
      setConversas({ reenvio: Boolean(reenvio), inicial: res.escolha });
      return;
    }
    setConversas(null);
    setDiagnostico(res.diagnostico_chatguru ?? null);
    if (!res.ok) {
      setMotivo(res.mensagem ?? "O aviso não foi enviado.");
      showToast({ type: "error", title: "Aviso não enviado", description: res.mensagem });
      return;
    }
    if (res.aviso) setAviso(res.aviso);
    setMotivo(res.motivo_chatguru ?? null);
    setEnvios(res.envios && res.envios.length > 1 ? res.envios : null);
    setRecusa(res.recusa_numero && res.aviso ? { ...res.recusa_numero, seq: res.aviso.seq } : null);
    if (res.ja_existia) {
      showToast({ type: "info", title: "Este pedido já tinha aviso de produção", description: "Nada foi enviado de novo. Para mandar outra mensagem, use Reenviar." });
      return;
    }
    if (res.envios && res.envios.length > 1) {
      const ok = res.envios.filter((e) => e.aviso?.estado === "executado").length;
      showToast({
        type: ok === res.envios.length ? "success" : "warning",
        title: `Aviso: ${ok} de ${res.envios.length} conversas com diálogo executado`,
        description: `Pedido ${idInt}.`
      });
      return;
    }
    const a = res.aviso;
    if (a?.estado === "executado") {
      showToast({ type: "success", title: "Aviso enviado", description: `Pedido ${idInt}: ${ROTULO_ESTADO_AVISO.executado}.` });
    } else if (a?.estado === "falhou") {
      showToast({ type: "error", title: "O ChatGuru recusou o aviso", description: `${res.motivo_chatguru ? `ChatGuru: ${res.motivo_chatguru} ` : ""}Nada saiu.` });
    } else {
      showToast({ type: "warning", title: "Resultado desconhecido", description: "Não dá para saber se a mensagem saiu. O WhatsApp fica travado até alguém conferir no ChatGuru." });
    }
  }

  async function liberarProducao(comAviso: boolean) {
    if (ocupado) return;
    setOcupado(true);
    showToast({ type: "info", title: "Liberando para produção...", description: "Aguarde a validação das regras." });
    // A liberação é a antiga e não depende do aviso (lib/liberar-com-aviso). Sem enviar,
    // o aviso nem é chamado; com enviar, ele só roda depois e seu erro não desfaz nada.
    const reenvio = aviso ? { seqAtual: aviso.seq } : undefined;
    const selecao = selecaoDaJanela();
    let liberouAgora = false;
    const r = await liberarComAviso({
      liberar: async () => {
        const res = await liberarPropostaParaProducaoPeloServidor(idInt);
        setOcupado(false);
        if (res.success) {
          liberouAgora = true;
          setLiberou(true);
          showToast({ type: "success", title: "Proposta liberada", description: "A proposta agora está na lista de Produção/Pedidos." });
        }
        return res;
      },
      // Já houve aviso: "Liberar e enviar" manda de novo, pela tentativa que a janela mostrou.
      enviarAviso: comAviso ? () => enviar(reenvio, selecao) : undefined
    });
    setOcupado(false);
    if (!r.liberou) {
      showToast({ type: "error", title: "Erro de Validação", description: r.erroLiberacao ?? "Não foi possível enviar para produção." });
      return;
    }
    if (!comAviso && liberouAgora) onConcluido(true);
  }

  async function liberarNumero(resposta: RespostaLiberacao) {
    if (!aviso || ocupado) return;
    setOcupado(true);
    const res = await liberarNumeroAviso(idInt, aviso.seq, resposta);
    setOcupado(false);
    setLiberandoNumero(false);
    if (!res.ok) {
      showToast({ type: "error", title: "Número não liberado", description: res.mensagem });
      return;
    }
    if (res.aviso) setAviso(res.aviso);
    showToast({
      type: "success",
      title: "Número liberado",
      description: resposta === "soltar" ? `Pedido ${idInt}: conversa solta na trava compartilhada.` : `Pedido ${idInt}: conferido no ChatGuru.`
    });
  }

  const destinatario = preparo?.destinatario ?? null;
  const bloqueio = preparo?.bloqueio ?? null;
  const escolhaDaJanela = preparo?.escolha ?? null;
  const faltaEscolher = Boolean(escolhaDaJanela && selecionadas.length === 0);
  const travado = aviso?.estado === "desconhecido" && aviso.trava_conversa === true;
  // v19: aviso terminado com a conversa presa na trava compartilhada.
  const presa = travaCompartilhadaPresa(aviso);
  const recusaAtual = recusa && aviso && recusa.seq === aviso.seq && aviso.estado === "falhou" ? recusa : null;
  const podeReenviar = Boolean(aviso && aviso.estado !== "preparando" && !travado && !presa && !bloqueio);

  const botao = "rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {modo === "liberar" && !mostrarResultado ? "Liberar proposta para Produção?" : "Aviso: pedido em produção"}
          </h2>
          <button
            type="button"
            onClick={fechar}
            disabled={ocupado}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6 text-sm text-slate-700 dark:text-slate-300">
          {modo === "liberar" && !mostrarResultado && (
            <>
              <p>
                Você está prestes a enviar a proposta <strong>#{idInt}</strong> para a fila de Produção/Pedidos.
              </p>
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <ul className="list-disc space-y-1 pl-4">
                  <li>A proposta será enviada para <strong>REVISAO PRODUCAO</strong>.</li>
                  <li>A entrada na fila de Produção será ativada.</li>
                  <li>Certifique-se de que os pagamentos e artes já foram conferidos.</li>
                </ul>
              </div>
              <p className="font-semibold text-slate-950 dark:text-slate-100">
                Enviar mensagem ao cliente avisando que o pedido entrou em produção?
              </p>
              {aviso && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Este pedido já recebeu o aviso de produção em {formatDateTime(aviso.criado_em)}. Liberar e enviar manda a mensagem de novo.
                </p>
              )}
            </>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Contato responsável do pedido</p>
              {!preparo ? (
                <p>Lendo o contato...</p>
              ) : destinatario ? (
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {destinatario.nome} · {destinatario.whatsapp || "sem WhatsApp"}
                </p>
              ) : (
                <p className="font-semibold text-red-700 dark:text-red-300">{erroPreparo ?? "O pedido não tem contato responsável."}</p>
              )}
              {preparo?.conversa && (
                <p>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Vai para a conversa do ChatGuru: </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {preparo.conversa.nome} · {preparo.conversa.numero}
                  </span>
                </p>
              )}
              {escolhaDaJanela && !bloqueio && (
                <div className="space-y-2">
                  <p>{MOTIVO_ESCOLHA[escolhaDaJanela.motivo]}</p>
                  <ListaConversas
                    conversas={escolhaDaJanela.conversas}
                    selecionadas={selecionadas}
                    onChange={setSelecionadas}
                    disabled={ocupado || liberou}
                  />
                </div>
              )}
              {preparo?.modoTeste && (
                <p className="text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                  modo teste: só pedidos e contatos do cliente #14
                </p>
              )}
              {bloqueio && <p className="font-semibold text-red-700 dark:text-red-300">{bloqueio}</p>}
            </div>
          </div>

          {aviso && (
            <div className="space-y-1">
              <p>
                {aviso.estado === "executado" || aviso.estado === "enviado" ? "Aviso enviado" : "Tentativa de aviso"} em{" "}
                {formatDateTime(aviso.criado_em)} por {aviso.autor_nome || "—"}:{" "}
                <strong>{ROTULO_ESTADO_AVISO[aviso.estado] ?? aviso.estado}</strong>
                {aviso.modo_teste ? " · modo teste" : ""}
              </p>
              {aviso.liberacao && (
                <p className="text-slate-600 dark:text-slate-300">
                  {textoDaLiberacao(aviso.liberacao, formatDateTime(aviso.liberacao.em))}
                </p>
              )}
              {presa && <p className="text-amber-800 dark:text-amber-200">{TEXTO_TRAVA_PRESA}</p>}
              {travado && (
                <p className="text-amber-800 dark:text-amber-200">
                  Não se sabe se a mensagem saiu. Este WhatsApp fica travado para novos avisos até alguém conferir no ChatGuru (avise o ADM).
                </p>
              )}
            </div>
          )}
          {envios && (
            <ul className="space-y-0.5">
              {envios.map((e) => (
                <li key={e.chat_id}>
                  {e.nome} · {e.numero}:{" "}
                  <strong>{e.recusa ? "não enviado" : e.aviso ? (ROTULO_ESTADO_AVISO[e.aviso.estado] ?? e.aviso.estado) : "—"}</strong>
                  {e.recusa ? ` (${e.recusa})` : e.motivo_chatguru && e.aviso?.estado !== "executado" ? ` (ChatGuru: ${e.motivo_chatguru})` : ""}
                </li>
              ))}
            </ul>
          )}
          {mostrarResultado && motivo && !envios && (!aviso || aviso.estado !== "executado") && (
            <p className="text-red-700 dark:text-red-300">Motivo: {motivo}</p>
          )}
          {recusaAtual && (
            <p className="font-semibold text-red-700 dark:text-red-300">
              Número não encontrado no ChatGuru: {recusaAtual.numero_enviado}. Use Ver conversas do cliente para escolher outra conversa.
            </p>
          )}
          {ehAdm && diagnostico && diagnostico.length > 0 && (
            <div className="break-words font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {diagnostico.map((d) => (
                <p key={d.etapa}>
                  ChatGuru · {d.etapa === "campos" ? "campos" : "diálogo"} · HTTP {d.http ?? "—"}: {d.texto || "(vazio)"}
                </p>
              ))}
            </div>
          )}
          {confirmandoReenvio && aviso && (
            <div className="rounded-xl border border-slate-300 p-3 dark:border-slate-600">
              <p className="font-semibold text-slate-950 dark:text-slate-100">Reenviar aviso de pedido em produção?</p>
              <p className="mt-1">
                {aviso.estado === "desconhecido"
                  ? "Não se sabe se o aviso anterior saiu. Confira no ChatGuru antes: se ele saiu, o cliente vai receber duas mensagens."
                  : "O cliente vai receber outra mensagem pelo WhatsApp."}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmandoReenvio(false)}
                  className={`${botao} border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={ocupado || faltaEscolher}
                  onClick={() => void enviar({ seqAtual: aviso.seq }, selecaoDaJanela())}
                  className={`${botao} bg-[#0b2f4a] text-white hover:bg-[#123f61]`}
                >
                  {ocupado ? "Enviando..." : "Reenviar"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
          {modo === "liberar" && !mostrarResultado ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={ocupado}
                className={`${botao} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void liberarProducao(false)}
                disabled={ocupado}
                className={`${botao} border border-[#0b2f4a] bg-white text-[#0b2f4a] hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100`}
              >
                Liberar sem enviar
              </button>
              <button
                type="button"
                onClick={() => void liberarProducao(true)}
                disabled={ocupado || !preparo || Boolean(bloqueio) || faltaEscolher}
                title={bloqueio ?? (faltaEscolher ? "Marque para qual conversa vai o aviso." : undefined)}
                className={`${botao} bg-[#0b2f4a] text-white hover:bg-[#123f61]`}
              >
                {ocupado ? "Liberando..." : "Liberar e enviar"}
              </button>
            </>
          ) : (
            <>
              {(travado || presa) && ehAdm && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setLiberandoNumero(true)}
                  className={`${botao} border border-amber-300 bg-white text-amber-800 dark:bg-slate-900 dark:text-amber-200`}
                >
                  Liberar número
                </button>
              )}
              {aviso && podeReenviar && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConversas({ reenvio: true, inicial: null })}
                  className={`${botao} border bg-white dark:bg-slate-900 ${recusaAtual ? "border-red-300 text-red-700 dark:text-red-300" : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"}`}
                >
                  Ver conversas do cliente
                </button>
              )}
              {!aviso && modo === "avisar" && (
                <button
                  type="button"
                  disabled={ocupado || !preparo || Boolean(bloqueio) || faltaEscolher}
                  title={bloqueio ?? (faltaEscolher ? "Marque para qual conversa vai o aviso." : undefined)}
                  onClick={() => void enviar(undefined, selecaoDaJanela())}
                  className={`${botao} bg-[#0b2f4a] text-white hover:bg-[#123f61]`}
                >
                  {ocupado ? "Enviando..." : "Enviar aviso"}
                </button>
              )}
              {podeReenviar && !confirmandoReenvio && (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setConfirmandoReenvio(true)}
                  className={`${botao} border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
                >
                  Reenviar
                </button>
              )}
              <button
                type="button"
                onClick={fechar}
                disabled={ocupado}
                className={`${botao} bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100`}
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>

      {conversas && (
        <ConversasDoClienteModal
          idInt={idInt}
          titulo={conversas.inicial ? "Para qual conversa enviar?" : "Conversas do cliente"}
          inicial={conversas.inicial}
          descricaoEnvio={
            conversas.reenvio
              ? "Cada conversa marcada recebe outra mensagem de pedido em produção."
              : "O cliente recebe o aviso de pedido em produção pelo WhatsApp da Ideal."
          }
          ocupado={ocupado}
          onEnviar={(s) => void (conversas.reenvio && aviso ? enviar({ seqAtual: aviso.seq }, s) : enviar(undefined, s))}
          onClose={() => setConversas(null)}
        />
      )}
      {liberandoNumero && (
        <LiberarNumeroModal
          idInt={idInt}
          soltarTrava={presa && !travado}
          ocupado={ocupado}
          onEscolher={(r) => void liberarNumero(r)}
          onClose={() => setLiberandoNumero(false)}
        />
      )}
    </div>
  );
}
