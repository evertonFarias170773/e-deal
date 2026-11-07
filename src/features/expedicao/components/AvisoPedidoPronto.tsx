"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { formatDateTime } from "@/lib/formatters/date";
import { ConfirmarAcaoModal } from "./ConfirmarAcaoModal";
import { CorrigirNumeroModal } from "./CorrigirNumeroModal";
import type { RecusaNumeroDoAviso } from "../hooks/useAvisosPedidoPronto";
import {
  ROTULO_ESTADO_AVISO,
  consultarStatusAvisoPronto,
  enviarAvisoPronto,
  reenviarAvisoPronto,
  type AvisoPronto,
  type ModeloAviso,
  type RecusaPorNumero
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
 * Recusa por número ("Chat não encontrado."): mostra o número enviado. Quem tem
 * cadastros.edit (ou ADM) vê "Corrigir número", que grava contatos.whats pela
 * gravação do cadastro; o Reenviar volta depois do salvar. Quem não tem vê o
 * pedido de correção e o Reenviar (a correção pode vir do cadastro).
 *
 * Desde 07/11/2026 o aviso é um diálogo do ChatGuru, um por forma de envio. O
 * servidor escolhe (`modelo`); sem diálogo, ou SEDEX sem etiqueta, o botão fica
 * apagado com o aviso. Sucesso é "executado" (não "entregue"). Diálogo em
 * incerteza trava o WhatsApp para novos avisos até alguém conferir no ChatGuru.
 */
export function AvisoPedidoPronto({
  idInt,
  statusInterno,
  aviso,
  modoTeste,
  podeOperar,
  podeEditarCadastro,
  recusaNumero,
  modelo,
  compacto = false,
  onAviso,
  onNumeroCorrigido
}: {
  idInt: number;
  statusInterno: string;
  aviso: AvisoPronto | undefined;
  modoTeste: boolean;
  podeOperar: boolean;
  podeEditarCadastro: boolean;
  recusaNumero: RecusaNumeroDoAviso | undefined;
  /** Diálogo do pedido; indefinido enquanto a leitura não volta (o servidor decide no envio). */
  modelo?: ModeloAviso;
  compacto?: boolean;
  onAviso: (idInt: number, aviso: AvisoPronto | null | undefined, modoTeste?: boolean, recusa?: RecusaPorNumero | null) => void;
  onNumeroCorrigido: (idInt: number) => void;
}) {
  const { showToast } = useAppToast();
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [corrigindo, setCorrigindo] = useState(false);

  if ((statusInterno ?? "").toUpperCase() !== "EXPEDICAO") return null;
  // Forma de envio sem diálogo, ou SEDEX sem etiqueta: botão apagado com o aviso.
  const bloqueio = modelo ? (modelo.bloqueio ?? (modelo.dialogo ? null : SEM_MODELO)) : null;
  if (!aviso && !podeOperar) return null;

  async function avisar() {
    if (ocupado) return;
    setOcupado(true);
    const res = await enviarAvisoPronto(idInt);
    setOcupado(false);
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
    toastDoResultado(res.aviso ?? null, res.motivo_chatguru, res.recusa_numero ?? null, res.etapa_chatguru ?? null);
  }

  async function reenviar() {
    if (!aviso || ocupado) return;
    setOcupado(true);
    const res = await reenviarAvisoPronto(idInt, aviso.seq);
    setOcupado(false);
    setConfirmando(false);
    onAviso(idInt, res.aviso, res.modo_teste, res.ja_existia ? undefined : (res.recusa_numero ?? null));
    if (!res.ok) {
      showToast({ type: "error", title: "Reenvio não feito", description: res.mensagem });
      return;
    }
    if (res.ja_existia) {
      showToast({ type: "info", title: "Outro envio chegou antes", description: "Nada foi enviado de novo." });
      return;
    }
    toastDoResultado(res.aviso ?? null, res.motivo_chatguru, res.recusa_numero ?? null, res.etapa_chatguru ?? null);
  }

  async function atualizarStatus() {
    if (ocupado) return;
    setOcupado(true);
    const res = await consultarStatusAvisoPronto(idInt);
    setOcupado(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) showToast({ type: "error", title: "Status não consultado", description: res.mensagem });
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
        description: `${motivo ? `ChatGuru: ${motivo} ` : ""}Nada saiu. ${podeEditarCadastro ? "Use Corrigir número e depois Reenviar." : "Peça a correção a quem pode editar o cadastro."}`
      });
    } else if (a.estado === "falhou") {
      showToast({
        type: "error",
        title: `O ChatGuru recusou o envio${naEtapa}`,
        description: `${motivo ? `ChatGuru: ${motivo} ` : ""}Nada saiu. Confira o WhatsApp do contato e use Reenviar.`
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
      </div>
    );
  }

  const saiu = aviso.estado === "enviado" || aviso.estado === "aguardando" || aviso.estado === "executado";
  // Diálogo incerto segura o WhatsApp: Reenviar só depois de conferir no ChatGuru.
  const travado = aviso.estado === "desconhecido" && aviso.trava_conversa === true;
  // Recusa por número desta tentativa (só nesta tela: o servidor não grava o número).
  const recusa = aviso.estado === "falhou" && recusaNumero && recusaNumero.seq === aviso.seq ? recusaNumero : null;
  // Com recusa por número ainda não corrigida, quem pode corrigir corrige antes de reenviar.
  const esperaCorrecao = Boolean(recusa && !recusa.corrigido && podeEditarCadastro);
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
      {bloqueio && aviso.estado !== "preparando" && (
        <span className="max-w-[18rem] text-slate-600 dark:text-slate-300">{bloqueio}</span>
      )}
      {recusa && (
        <span className="max-w-[18rem] font-semibold text-red-700 dark:text-red-300">
          Número não encontrado no ChatGuru: {recusa.numero_enviado}
        </span>
      )}
      {recusa && recusa.corrigido && (
        <span className="max-w-[18rem] text-emerald-700 dark:text-emerald-300">Número corrigido no cadastro. Use Reenviar.</span>
      )}
      {recusa && !recusa.corrigido && !podeEditarCadastro && (
        <span className="max-w-[18rem] text-slate-600 dark:text-slate-300">Peça a correção a quem pode editar o cadastro.</span>
      )}
      {recusa && !recusa.corrigido && podeEditarCadastro && (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => setCorrigindo(true)}
          className="font-semibold text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-300"
        >
          Corrigir número
        </button>
      )}
      {podeOperar && (
        <span className="flex gap-2">
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
          {aviso.estado !== "preparando" && !esperaCorrecao && !travado && !bloqueio && (
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
      {corrigindo && recusa && (
        <CorrigirNumeroModal
          idContato={recusa.id_contato}
          numeroEnviado={recusa.numero_enviado}
          onClose={() => setCorrigindo(false)}
          onSalvo={() => {
            setCorrigindo(false);
            onNumeroCorrigido(idInt);
            showToast({ type: "success", title: "Número salvo no cadastro", description: "Use Reenviar para mandar o aviso de novo." });
          }}
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
    </div>
  );
}
