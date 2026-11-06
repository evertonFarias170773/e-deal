"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { formatDateTime } from "@/lib/formatters/date";
import { ConfirmarAcaoModal } from "./ConfirmarAcaoModal";
import {
  ROTULO_ESTADO_AVISO,
  consultarStatusAvisoPronto,
  enviarAvisoPronto,
  reenviarAvisoPronto,
  type AvisoPronto
} from "../services/aviso-pronto.client";

/**
 * "Avisar cliente: pedido pronto" pelo WhatsApp da Ideal (ChatGuru), 06/11/2026.
 *
 * Só pedido na bancada (status EXPEDICAO) e só quem opera a Expedição. Depois do
 * envio o botão vira "Aviso enviado em {data e hora} por {usuário}" com o
 * estado. "Reenviar" pede confirmação e o servidor faz uma reserva nova. Em
 * "resultado desconhecido" nada é reenviado sozinho: a tela pede para conferir
 * no ChatGuru antes.
 */
export function AvisoPedidoPronto({
  idInt,
  statusInterno,
  aviso,
  modoTeste,
  podeOperar,
  compacto = false,
  onAviso
}: {
  idInt: number;
  statusInterno: string;
  aviso: AvisoPronto | undefined;
  modoTeste: boolean;
  podeOperar: boolean;
  compacto?: boolean;
  onAviso: (idInt: number, aviso: AvisoPronto | null | undefined, modoTeste?: boolean) => void;
}) {
  const { showToast } = useAppToast();
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  if ((statusInterno ?? "").toUpperCase() !== "EXPEDICAO") return null;
  if (!aviso && !podeOperar) return null;

  async function avisar() {
    if (ocupado) return;
    setOcupado(true);
    const res = await enviarAvisoPronto(idInt);
    setOcupado(false);
    onAviso(idInt, res.aviso, res.modo_teste);
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
    toastDoResultado(res.aviso ?? null, res.motivo_chatguru);
  }

  async function reenviar() {
    if (!aviso || ocupado) return;
    setOcupado(true);
    const res = await reenviarAvisoPronto(idInt, aviso.seq);
    setOcupado(false);
    setConfirmando(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) {
      showToast({ type: "error", title: "Reenvio não feito", description: res.mensagem });
      return;
    }
    if (res.ja_existia) {
      showToast({ type: "info", title: "Outro envio chegou antes", description: "Nada foi enviado de novo." });
      return;
    }
    toastDoResultado(res.aviso ?? null, res.motivo_chatguru);
  }

  async function atualizarStatus() {
    if (ocupado) return;
    setOcupado(true);
    const res = await consultarStatusAvisoPronto(idInt);
    setOcupado(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) showToast({ type: "error", title: "Status não consultado", description: res.mensagem });
  }

  function toastDoResultado(a: AvisoPronto | null, motivo?: string | null) {
    if (!a) return;
    if (a.estado === "enviado" || a.estado === "aguardando") {
      showToast({
        type: "success",
        title: "Aviso enviado",
        description: `Pedido ${idInt}: ${ROTULO_ESTADO_AVISO[a.estado]}.${a.modo_teste ? " Modo teste: foi para o número de teste." : ""}`
      });
    } else if (a.estado === "falhou") {
      showToast({
        type: "error",
        title: "O ChatGuru recusou o envio",
        description: `${motivo ? `ChatGuru: ${motivo} ` : ""}Nada saiu. Confira o WhatsApp do contato e use Reenviar.`
      });
    } else {
      showToast({
        type: "warning",
        title: "Resultado desconhecido",
        description: "Não dá para saber se a mensagem saiu. Confira no ChatGuru antes de reenviar."
      });
    }
  }

  const texto = compacto ? "text-[11px]" : "text-xs";

  if (!aviso) {
    return (
      <div className="mt-1.5 flex flex-col items-end gap-0.5">
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void avisar()}
          className={`inline-flex items-center gap-1 rounded-2xl border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 ${texto} font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {ocupado ? "Enviando..." : "Avisar cliente: pedido pronto"}
        </button>
        {modoTeste && <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">modo teste</span>}
      </div>
    );
  }

  const saiu = aviso.estado === "enviado" || aviso.estado === "aguardando";
  const cor =
    aviso.estado === "enviado"
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
        {ROTULO_ESTADO_AVISO[aviso.estado]}
        {aviso.modo_teste ? " · modo teste" : ""}
      </span>
      {aviso.estado === "desconhecido" && (
        <span className="max-w-[16rem] text-amber-800 dark:text-amber-200">
          Confira no ChatGuru se a mensagem saiu antes de reenviar.
        </span>
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
          {aviso.estado !== "preparando" && (
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
      {confirmando && (
        <ConfirmarAcaoModal
          titulo="Reenviar aviso de pedido pronto?"
          descricao={
            aviso.estado === "desconhecido"
              ? `Não se sabe se o aviso anterior do pedido ${idInt} saiu. Confira no ChatGuru antes: se ele saiu, o cliente vai receber duas mensagens.`
              : `O cliente do pedido ${idInt} vai receber outra mensagem pelo WhatsApp.`
          }
          detalhe={modoTeste ? "Modo teste: a mensagem vai para o número de teste." : undefined}
          rotuloConfirmar={ocupado ? "Enviando..." : "Reenviar"}
          salvando={ocupado}
          onConfirmar={() => void reenviar()}
          onClose={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}
