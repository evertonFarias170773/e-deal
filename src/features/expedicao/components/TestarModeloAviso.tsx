"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { formatDateTime } from "@/lib/formatters/date";
import { ConfirmarAcaoModal } from "./ConfirmarAcaoModal";
import { LiberarNumeroModal } from "./LiberarNumeroModal";
import {
  DIALOGOS_AVISO,
  ROTULO_ESTADO_AVISO,
  liberarNumeroAviso,
  testarModeloAviso,
  type AvisoPronto,
  type CamposDoTeste,
  type DiagnosticoChatGuru,
  type DialogoAviso,
  type RecusaPorNumero
} from "../services/aviso-pronto.client";

/**
 * "Testar modelo" do aviso pedido pronto (07/11/2026). Só aparece com o modo
 * teste ligado e em pedido do cliente #14 (o servidor decide e recusa fora
 * disso). Escolhe um dos seis diálogos sem olhar a forma de envio; o campo que o
 * pedido não tem vai com valor de teste (Sedex_Conhecimento TESTE000000BR,
 * Cidade_Destino Porto Alegre/RS, Nota_Fiscal —). Cada teste é um envio novo,
 * com confirmação, e não conta como aviso do pedido; a trava por conversa vale.
 */
export function TestarModeloAviso({
  idInt,
  teste,
  ehAdm,
  onAviso
}: {
  idInt: number;
  /** Último envio de teste do pedido. */
  teste: AvisoPronto | undefined;
  ehAdm: boolean;
  onAviso: (idInt: number, aviso: AvisoPronto | null | undefined, modoTeste?: boolean, recusa?: RecusaPorNumero | null) => void;
}) {
  const { showToast } = useAppToast();
  const [dialogo, setDialogo] = useState<DialogoAviso>("Sedex");
  const [confirmando, setConfirmando] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  // Só desta tela: campos enviados e diagnóstico (o servidor não grava).
  const [campos, setCampos] = useState<CamposDoTeste | null>(null);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoChatGuru[] | null>(null);

  const travado = teste?.estado === "desconhecido" && teste.trava_conversa === true;

  async function testar() {
    if (ocupado) return;
    setOcupado(true);
    const res = await testarModeloAviso(idInt, dialogo);
    setOcupado(false);
    setConfirmando(false);
    setDiagnostico(res.diagnostico_chatguru ?? null);
    setCampos(res.teste ?? null);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) {
      showToast({ type: "error", title: "Teste não enviado", description: res.mensagem });
      return;
    }
    const a = res.aviso;
    if (!a) return;
    const naEtapa = res.etapa_chatguru === "campos" ? " (na gravação dos campos)" : res.etapa_chatguru === "dialogo" ? " (na execução do diálogo)" : "";
    if (a.estado === "executado") {
      showToast({ type: "success", title: "Teste enviado", description: `Pedido ${idInt}: diálogo ${a.dialogo}, ${ROTULO_ESTADO_AVISO.executado}.` });
    } else if (a.estado === "falhou") {
      showToast({
        type: "error",
        title: `O ChatGuru recusou o teste${naEtapa}`,
        description: `${res.motivo_chatguru ? `ChatGuru: ${res.motivo_chatguru} ` : ""}Nada saiu.`
      });
    } else {
      showToast({
        type: "warning",
        title: `Resultado desconhecido${naEtapa}`,
        description: "Não dá para saber se o diálogo foi executado. Este WhatsApp fica travado até alguém conferir no ChatGuru."
      });
    }
  }

  async function liberar(resposta: "enviada" | "nao_enviada") {
    if (!teste || ocupado) return;
    setOcupado(true);
    const res = await liberarNumeroAviso(idInt, teste.seq, resposta);
    setOcupado(false);
    setLiberando(false);
    onAviso(idInt, res.aviso, res.modo_teste);
    if (!res.ok) showToast({ type: "error", title: "Número não liberado", description: res.mensagem });
    else showToast({ type: "success", title: "Número liberado", description: `Pedido ${idInt}: teste conferido no ChatGuru.` });
  }

  return (
    <div className="mt-1.5 flex flex-col items-end gap-0.5 rounded-2xl border border-dashed border-amber-300 px-2 py-1.5 text-right text-[11px] dark:border-amber-800">
      <span className="flex items-center gap-1">
        <FlaskConical className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
        <select
          aria-label="Diálogo para testar"
          value={dialogo}
          disabled={ocupado}
          onChange={(e) => setDialogo(e.target.value as DialogoAviso)}
          className="rounded-xl border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-900"
        >
          {DIALOGOS_AVISO.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={ocupado || travado}
          title={travado ? "WhatsApp travado: confira no ChatGuru e libere o número antes." : undefined}
          onClick={() => setConfirmando(true)}
          className="font-semibold text-amber-800 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-200"
        >
          {ocupado ? "Enviando..." : "Testar modelo"}
        </button>
      </span>
      {teste && (
        <span className="text-slate-600 dark:text-slate-300">
          Teste {teste.dialogo ?? "—"} em {formatDateTime(teste.criado_em)} por {teste.autor_nome || "—"}:{" "}
          <span className="font-semibold">{ROTULO_ESTADO_AVISO[teste.estado] ?? teste.estado}</span>
        </span>
      )}
      {teste?.liberacao && (
        <span className="max-w-[18rem] text-slate-600 dark:text-slate-300">
          Liberado por {teste.liberacao.por || "—"} em {formatDateTime(teste.liberacao.em)}:{" "}
          {teste.liberacao.resposta === "enviada" ? "a mensagem foi enviada" : "a mensagem não foi enviada"}.
        </span>
      )}
      {travado && (
        <span className="max-w-[18rem] text-amber-800 dark:text-amber-200">
          Não se sabe se o diálogo foi executado. Este WhatsApp fica travado até alguém conferir no ChatGuru (avise o ADM).
        </span>
      )}
      {travado && ehAdm && (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => setLiberando(true)}
          className="font-semibold text-amber-800 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-200"
        >
          Liberar número
        </button>
      )}
      {campos && (
        <span className="max-w-[22rem] break-words text-slate-500 dark:text-slate-400">
          {Object.entries(campos.valores).map(([nome, valor]) => (
            <span key={nome} className="block">
              {nome}: {valor}
              {campos.de_teste.includes(nome) ? " (valor de teste)" : ""}
            </span>
          ))}
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
      {confirmando && (
        <ConfirmarAcaoModal
          titulo={`Enviar teste do diálogo ${dialogo}?`}
          descricao={`O contato do pedido ${idInt} vai receber o diálogo ${dialogo} pelo WhatsApp. Não conta como aviso do pedido.`}
          detalhe="Campo que o pedido não tem vai com valor de teste: Sedex_Conhecimento TESTE000000BR, Cidade_Destino Porto Alegre/RS, Nota_Fiscal —."
          rotuloConfirmar={ocupado ? "Enviando..." : "Enviar teste"}
          salvando={ocupado}
          onConfirmar={() => void testar()}
          onClose={() => setConfirmando(false)}
        />
      )}
      {liberando && (
        <LiberarNumeroModal
          idInt={idInt}
          teste
          ocupado={ocupado}
          onEscolher={(r) => void liberar(r)}
          onClose={() => setLiberando(false)}
        />
      )}
    </div>
  );
}
