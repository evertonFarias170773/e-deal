"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { formatDateTime } from "@/lib/formatters/date";
import { ConfirmarAcaoModal } from "./ConfirmarAcaoModal";
import { ConversasDoClienteModal } from "./ConversasDoCliente";
import { LiberarNumeroModal } from "./LiberarNumeroModal";
import { TestarModeloAviso } from "./TestarModeloAviso";
import type { RecusaNumeroDoAviso } from "../hooks/useAvisosPedidoPronto";
import {
  ROTULO_ESTADO_AVISO,
  consultarStatusAvisoPronto,
  enviarAvisoPronto,
  liberarNumeroAviso,
  travaCompartilhadaPresa,
  textoDaLiberacao,
  TEXTO_TRAVA_PRESA,
  type RespostaLiberacao,
  reenviarAvisoPronto,
  type AvisoPronto,
  type DiagnosticoChatGuru,
  type EnvioPorConversa,
  type EscolhaConversa,
  type ModeloAviso,
  type RecusaPorNumero,
  type SelecaoConversas
} from "../services/aviso-pronto.client";

const SEM_MODELO = "Sem modelo de mensagem para esta forma de envio.";

/**
 * "Avisar cliente: pedido pronto" pelo WhatsApp da Ideal (ChatGuru), 06/11/2026.
 *
 * Só pedido na bancada (status EXPEDICAO) e só quem opera a Expedição. Depois do
 * envio o botão vira "Aviso enviado em {data e hora} por {usuário}" com o
 * estado. "Reenviar" pede confirmação e o servidor faz uma reserva nova. Em
 * "resultado desconhecido" nada é reenviado sozinho: a tela pede para conferir
 * no ChatGuru antes.
 *
 * Destino (09/11/2026): a conversa do cliente no ChatGuru (remetente 3478), que o
 * servidor escolhe pela visão chatguru_contatos_3478. Se a regra não decide
 * (o WhatsApp do contato casa com várias conversas, ou com nenhuma), a resposta
 * traz a lista e a tela abre a escolha: uma, várias ou todas, com confirmação.
 * Recusa por número ("Chat não encontrado."): mostra o número usado e "Ver
 * conversas do cliente" (no lugar do antigo "Corrigir número", que gravava
 * contatos.whats). Nada aqui grava em contatos.
 *
 * Desde 07/11/2026 o aviso é um diálogo do ChatGuru, um por forma de envio. O
 * servidor escolhe (`modelo`); sem diálogo, ou SEDEX sem etiqueta, o botão fica
 * apagado com o aviso. Sucesso é "executado" (não "entregue"). Diálogo em
 * incerteza trava o WhatsApp para novos avisos até alguém conferir no ChatGuru:
 * o ADM usa "Liberar número" e responde o que conferiu. Só o ADM vê também o
 * diagnóstico (HTTP e texto do ChatGuru) do último envio feito nesta tela.
 *
 * "Testar modelo" (TestarModeloAviso): só com o modo teste ligado e em pedido do
 * cliente #14 (modelo.testavel, decidido no servidor).
 */
export function AvisoPedidoPronto({
  idInt,
  statusInterno,
  aviso,
  modoTeste,
  podeOperar,
  ehAdm = false,
  recusaNumero,
  modelo,
  teste,
  compacto = false,
  onAviso
}: {
  idInt: number;
  statusInterno: string;
  aviso: AvisoPronto | undefined;
  modoTeste: boolean;
  podeOperar: boolean;
  /** Administrador: vê o diagnóstico do ChatGuru e o "Liberar número". */
  ehAdm?: boolean;
  recusaNumero: RecusaNumeroDoAviso | undefined;
  /** Diálogo do pedido; indefinido enquanto a leitura não volta (o servidor decide no envio). */
  modelo?: ModeloAviso;
  /** Último envio do "Testar modelo" do pedido. */
  teste?: AvisoPronto;
  compacto?: boolean;
  onAviso: (idInt: number, aviso: AvisoPronto | null | undefined, modoTeste?: boolean, recusa?: RecusaPorNumero | null) => void;
}) {
  const { showToast } = useAppToast();
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // Escolha da conversa: veio do servidor (a regra não decidiu) ou "Ver conversas do cliente".
  const [conversas, setConversas] = useState<{ op: "enviar" | "reenviar"; inicial: EscolhaConversa | null } | null>(null);
  const [liberando, setLiberando] = useState(false);
  // Diagnóstico do último envio feito nesta tela (só ADM; o servidor não grava).
  const [diagnostico, setDiagnostico] = useState<DiagnosticoChatGuru[] | null>(null);

  if ((statusInterno ?? "").toUpperCase() !== "EXPEDICAO") return null;
  // Forma de envio sem diálogo, ou SEDEX sem etiqueta: botão apagado com o aviso.
  const bloqueio = modelo ? (modelo.bloqueio ?? (modelo.dialogo ? null : SEM_MODELO)) : null;
  if (!aviso && !podeOperar) return null;

  async function avisar(selecao?: SelecaoConversas) {
    if (ocupado) return;
    setOcupado(true);
    const res = await enviarAvisoPronto(idInt, selecao);
    setOcupado(false);
    if (res.ok && res.escolha) {
      setConversas({ op: "enviar", inicial: res.escolha });
      return;
    }
    setConversas(null);
    setDiagnostico(res.diagnostico_chatguru ?? null);
    onAviso(idInt, res.aviso, res.modo_teste, res.ja_existia ? undefined : (res.recusa_numero ?? null));
    if (!res.ok) {
      showToast({ type: "error", title: "Aviso não enviado", description: res.mensagem });
      return;
    }
    if (res.ja_existia) {
      showToast({
        type: "info",
        title: "Este pedido já tinha aviso",
        description: "Nada foi enviado de novo. Para mandar outra mensagem, use Reenviar."
      });
      return;
    }
    if (res.envios && res.envios.length > 1) toastDeVarias(res.envios);
    else toastDoResultado(res.aviso ?? null, res.motivo_chatguru, res.recusa_numero ?? null, res.etapa_chatguru ?? null);
  }

  async function reenviar(selecao?: SelecaoConversas) {
    if (!aviso || ocupado) return;
    setOcupado(true);
    const res = await reenviarAvisoPronto(idInt, aviso.seq, selecao);
    setOcupado(false);
    setConfirmando(false);
    if (res.ok && res.escolha) {
      setConversas({ op: "reenviar", inicial: res.escolha });
      return;
    }
    setConversas(null);
    setDiagnostico(res.diagnostico_chatguru ?? null);
    onAviso(idInt, res.aviso, res.modo_teste, res.ja_existia ? undefined : (res.recusa_numero ?? null));
    if (!res.ok) {
      showToast({ type: "error", title: "Reenvio não feito", description: res.mensagem });
      return;
    }
    if (res.ja_existia) {
      showToast({ type: "info", title: "Outro envio chegou antes", description: "Nada foi enviado de novo." });
      return;
    }
    if (res.envios && res.envios.length > 1) toastDeVarias(res.envios);
    else toastDoResultado(res.aviso ?? null, res.motivo_chatguru, res.recusa_numero ?? null, res.etapa_chatguru ?? null);
  }

  function toastDeVarias(envios: EnvioPorConversa[]) {
    const ok = envios.filter((e) => e.aviso?.estado === "executado").length;
    const resumo = envios
      .map((e) => `${e.nome}: ${e.recusa ? "não enviado" : e.aviso ? (ROTULO_ESTADO_AVISO[e.aviso.estado] ?? e.aviso.estado) : "—"}`)
      .join("; ");
    showToast({
      type: ok === envios.length ? "success" : "warning",
      title: `Aviso: ${ok} de ${envios.length} conversas com diálogo executado`,
      description: resumo
    });
  }

  async function atualizarStatus() {
    if (ocupado) return;
    setOcupado(true);
    const res = await consultarStatusAvisoPronto(idInt);
    setOcupado(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) showToast({ type: "error", title: "Status não consultado", description: res.mensagem });
  }

  async function liberar(resposta: RespostaLiberacao) {
    if (!aviso || ocupado) return;
    setOcupado(true);
    const res = await liberarNumeroAviso(idInt, aviso.seq, resposta);
    setOcupado(false);
    setLiberando(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) {
      showToast({ type: "error", title: "Número não liberado", description: res.mensagem });
      return;
    }
    showToast({
      type: "success",
      title: "Número liberado",
      description:
        resposta === "soltar"
          ? `Pedido ${idInt}: conversa solta na trava compartilhada. Nada foi reenviado.`
          : resposta === "enviada"
            ? `Pedido ${idInt}: aviso marcado como executado. Nada foi reenviado.`
            : `Pedido ${idInt}: aviso marcado como falhou. Já dá para usar Reenviar.`
    });
  }

  function toastDoResultado(
    a: AvisoPronto | null,
    motivo?: string | null,
    recusa?: RecusaPorNumero | null,
    etapa?: "campos" | "dialogo" | null
  ) {
    if (!a) return;
    const naEtapa = etapa === "campos" ? " (na gravação dos campos)" : etapa === "dialogo" ? " (na execução do diálogo)" : "";
    if (a.estado === "executado" || a.estado === "enviado" || a.estado === "aguardando") {
      showToast({
        type: "success",
        title: "Aviso enviado",
        description: `Pedido ${idInt}: ${a.dialogo ? `diálogo ${a.dialogo}, ` : ""}${ROTULO_ESTADO_AVISO[a.estado]}.${a.modo_teste ? " Modo teste." : ""}`
      });
    } else if (a.estado === "falhou" && recusa) {
      showToast({
        type: "error",
        title: `Número não encontrado no ChatGuru: ${recusa.numero_enviado}`,
        description: `${motivo ? `ChatGuru: ${motivo} ` : ""}Nada saiu. Use Ver conversas do cliente para escolher outra conversa.`
      });
    } else if (a.estado === "falhou") {
      showToast({
        type: "error",
        title: `O ChatGuru recusou o envio${naEtapa}`,
        description: `${motivo ? `ChatGuru: ${motivo} ` : ""}Nada saiu. Confira a conversa no ChatGuru e use Reenviar.`
      });
    } else {
      showToast({
        type: "warning",
        title: `Resultado desconhecido${naEtapa}`,
        description: a.trava_conversa
          ? "Não dá para saber se o diálogo foi executado. Novos avisos para este WhatsApp ficam travados até alguém conferir no ChatGuru."
          : "Não dá para saber se a mensagem saiu. Confira no ChatGuru antes de reenviar."
      });
    }
  }

  const texto = compacto ? "text-[11px]" : "text-xs";
  const janelaConversas = conversas ? (
    <ConversasDoClienteModal
      idInt={idInt}
      titulo={conversas.inicial ? "Para qual conversa enviar?" : "Conversas do cliente"}
      inicial={conversas.inicial}
      descricaoEnvio={
        conversas.op === "enviar"
          ? "O cliente recebe o aviso de pedido pronto pelo WhatsApp da Ideal."
          : "Cada conversa marcada recebe outra mensagem de pedido pronto."
      }
      ocupado={ocupado}
      onEnviar={podeOperar ? (s) => void (conversas.op === "enviar" ? avisar(s) : reenviar(s)) : undefined}
      onClose={() => setConversas(null)}
    />
  ) : null;
  const painelTeste =
    modoTeste && podeOperar && modelo?.testavel ? (
      <TestarModeloAviso idInt={idInt} teste={teste} ehAdm={ehAdm} onAviso={onAviso} />
    ) : null;

  if (!aviso) {
    return (
      <div className="mt-1.5 flex flex-col items-end gap-0.5">
        <button
          type="button"
          disabled={ocupado || Boolean(bloqueio)}
          title={bloqueio ?? undefined}
          onClick={() => void avisar()}
          className={`inline-flex items-center gap-1 rounded-2xl border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 ${texto} font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {ocupado ? "Enviando..." : `Avisar cliente: pedido pronto${modelo?.dialogo ? ` (${modelo.dialogo})` : ""}`}
        </button>
        {bloqueio && <span className="max-w-[16rem] text-right text-[11px] text-slate-600 dark:text-slate-300">{bloqueio}</span>}
        {modoTeste && <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">modo teste</span>}
        {painelTeste}
        {janelaConversas}
      </div>
    );
  }

  const saiu = aviso.estado === "enviado" || aviso.estado === "aguardando" || aviso.estado === "executado";
  // Diálogo incerto segura o WhatsApp: Reenviar só depois de conferir no ChatGuru.
  const travado = aviso.estado === "desconhecido" && aviso.trava_conversa === true;
  // v19: aviso terminado com a conversa presa na trava compartilhada (o soltar falhou).
  const presa = travaCompartilhadaPresa(aviso);
  // Recusa por número desta tentativa (só nesta tela: o servidor não grava o motivo).
  const recusa = aviso.estado === "falhou" && recusaNumero && recusaNumero.seq === aviso.seq ? recusaNumero : null;
  const cor =
    aviso.estado === "enviado" || aviso.estado === "executado"
      ? "text-emerald-700 dark:text-emerald-300"
      : aviso.estado === "aguardando" || aviso.estado === "preparando"
        ? "text-sky-700 dark:text-sky-300"
        : aviso.estado === "falhou"
          ? "text-red-700 dark:text-red-300"
          : "text-amber-700 dark:text-amber-300";

  return (
    <div className={`mt-1.5 flex flex-col items-end gap-0.5 text-right ${texto}`}>
      <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
        <MessageCircle className="h-3.5 w-3.5" />
        {saiu ? "Aviso enviado" : "Tentativa de aviso"} em {formatDateTime(aviso.criado_em)} por {aviso.autor_nome || "—"}
      </span>
      <span className={`font-semibold ${cor}`}>
        {ROTULO_ESTADO_AVISO[aviso.estado] ?? aviso.estado}
        {aviso.dialogo ? ` · ${aviso.dialogo}` : ""}
        {aviso.modo_teste ? " · modo teste" : ""}
      </span>
      {aviso.estado === "desconhecido" && !travado && (
        <span className="max-w-[16rem] text-amber-800 dark:text-amber-200">
          Confira no ChatGuru se a mensagem saiu antes de reenviar.
        </span>
      )}
      {travado && (
        <span className="max-w-[18rem] text-amber-800 dark:text-amber-200">
          Não se sabe se o diálogo foi executado. Este WhatsApp fica travado para novos avisos até alguém conferir no ChatGuru (avise o ADM).
        </span>
      )}
      {presa && <span className="max-w-[18rem] text-amber-800 dark:text-amber-200">{TEXTO_TRAVA_PRESA}</span>}
      {(travado || presa) && ehAdm && (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => setLiberando(true)}
          className="font-semibold text-amber-800 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-200"
        >
          Liberar número
        </button>
      )}
      {aviso.liberacao && (
        <span className="max-w-[18rem] text-slate-600 dark:text-slate-300">
          {textoDaLiberacao(aviso.liberacao, formatDateTime(aviso.liberacao.em))}
        </span>
      )}
      {ehAdm && diagnostico && diagnostico.length > 0 && (
        <span className="max-w-[22rem] break-words text-left font-mono text-[10px] text-slate-500 dark:text-slate-400">
          {diagnostico.map((d) => (
            <span key={d.etapa} className="block">
              ChatGuru · {d.etapa === "campos" ? "campos" : "diálogo"} · HTTP {d.http ?? "—"}: {d.texto || "(vazio)"}
            </span>
          ))}
        </span>
      )}
      {bloqueio && aviso.estado !== "preparando" && (
        <span className="max-w-[18rem] text-slate-600 dark:text-slate-300">{bloqueio}</span>
      )}
      {recusa && (
        <span className="max-w-[18rem] font-semibold text-red-700 dark:text-red-300">
          Número não encontrado no ChatGuru: {recusa.numero_enviado}
        </span>
      )}
      {podeOperar && (
        <span className="flex gap-2">
          {aviso.estado !== "preparando" && !travado && !presa && !bloqueio && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setConversas({ op: "reenviar", inicial: null })}
              className={`font-semibold underline-offset-2 hover:underline disabled:opacity-50 ${recusa ? "text-red-700 dark:text-red-300" : "text-emerald-800 dark:text-emerald-300"}`}
            >
              Ver conversas do cliente
            </button>
          )}
          {aviso.message_id && aviso.estado !== "enviado" && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void atualizarStatus()}
              className="font-semibold text-sky-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-sky-300"
            >
              Atualizar status
            </button>
          )}
          {aviso.estado !== "preparando" && !travado && !presa && !bloqueio && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setConfirmando(true)}
              className="font-semibold text-slate-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-slate-200"
            >
              Reenviar
            </button>
          )}
        </span>
      )}
      {janelaConversas}
      {liberando && (
        <LiberarNumeroModal
          idInt={idInt}
          soltarTrava={presa && !travado}
          ocupado={ocupado}
          onEscolher={(r) => void liberar(r)}
          onClose={() => setLiberando(false)}
        />
      )}
      {confirmando && (
        <ConfirmarAcaoModal
          titulo="Reenviar aviso de pedido pronto?"
          descricao={
            aviso.estado === "desconhecido"
              ? `Não se sabe se o aviso anterior do pedido ${idInt} saiu. Confira no ChatGuru antes: se ele saiu, o cliente vai receber duas mensagens.`
              : `O cliente do pedido ${idInt} vai receber outra mensagem pelo WhatsApp.`
          }
          detalhe={modoTeste ? "Modo teste: só pedidos e contatos do cliente #14." : undefined}
          rotuloConfirmar={ocupado ? "Enviando..." : "Reenviar"}
          salvando={ocupado}
          onConfirmar={() => void reenviar()}
          onClose={() => setConfirmando(false)}
        />
      )}
      {painelTeste}
    </div>
  );
}
