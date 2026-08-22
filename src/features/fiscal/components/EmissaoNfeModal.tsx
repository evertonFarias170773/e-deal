"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, Send } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getSefazRejectionInfo } from "@/features/fiscal/constants/sefaz-rejeicoes";
import { lerDesfechoDaFocus, type DesfechoFocus } from "@/features/fiscal/services/desfecho-focus";
import type { NfeReadModel } from "@/features/nfe/types";

/**
 * Confirmação e acompanhamento da emissão de uma NF-e.
 *
 * Vive fora da lista de propósito: a mesma emissão é disparada da tela de
 * detalhe (Concluir e Emitir) e da lista (Enviar para Focus). Uma cópia só
 * garante que as duas telas confirmem, acompanhem e errem do mesmo jeito.
 *
 * A emissão passa SEMPRE por /api/fiscal/emitir-nfe, que valida sessão,
 * permissão e duplicidade. Este componente não conhece a URL do webhook.
 */

export type PassoEmissao =
  | "IDLE"
  | "SENDING"
  | "SENT_WAITING"
  | "QUERYING"
  | "AUTHORIZED"
  | "STILL_PROCESSING"
  | "ERROR";

const WEBHOOK_CONSULTA = "https://10074.hostoo.net.br/webhook/consultar-nfe-focus";

interface EmissaoNfeModalProps {
  nota: NfeReadModel;
  /** "IDLE" abre pedindo confirmação; "QUERYING" já entra consultando. */
  passoInicial: "IDLE" | "QUERYING";
  onFechar: () => void;
  /**
   * Relê a nota na fonte de quem abriu o modal — a lista recarrega o hook, a
   * tela de detalhe busca por id. Devolve a versão fresca ou null.
   */
  recarregar: () => Promise<NfeReadModel | null>;
  /**
   * Leva o operador até a nota para corrigi-la. Ausente quando ele já está nela
   * — aí o botão simplesmente não aparece.
   */
  onAbrirNota?: (idNota: string) => void;
}

export function EmissaoNfeModal({
  nota,
  passoInicial,
  onFechar,
  recarregar,
  onAbrirNota
}: EmissaoNfeModalProps) {
  const { showToast } = useAppToast();

  const [notaAtual, setNotaAtual] = useState<NfeReadModel>(nota);
  const [passo, setPasso] = useState<PassoEmissao>(passoInicial);
  const [erroTecnico, setErroTecnico] = useState<string>("");
  const [sefazCode, setSefazCode] = useState<string>("");
  const [sefazMessage, setSefazMessage] = useState<string>("");
  // Links vindos do proprio retorno da Focus. Existem mesmo quando o banco ainda
  // nao foi escrito - foi o caso da NFE-20481-001, autorizada na SEFAZ e ainda em
  // PROCESSANDO na tabela.
  const [danfeDoRetorno, setDanfeDoRetorno] = useState("");
  const jaAbriuDanfe = useRef(false);
  const jaConsultouNaAbertura = useRef(false);

  // Abrir já consultando (ação "Consultar status" da lista). O passo inicial já
  // é QUERYING, então nada de estado é escrito aqui de forma síncrona.
  useEffect(() => {
    if (passoInicial !== "QUERYING" || jaConsultouNaAbertura.current) return;
    jaConsultouNaAbertura.current = true;
    void consultarStatus(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passoInicial]);

  /** Endereço público de um documento da Focus, conforme o ambiente da nota. */
  function urlDaFocus(caminho: string): string {
    if (!caminho) return "";
    const base =
      String(notaAtual.ambiente || "").toLowerCase() === "producao"
        ? "https://api.focusnfe.com.br"
        : "https://homologacao.focusnfe.com.br";
    return caminho.startsWith("http") ? caminho : `${base}${caminho}`;
  }

  /**
   * Resolve o desfecho pela PRÓPRIA resposta, sem depender de o banco já ter sido
   * escrito. Devolve true quando concluiu — aí quem chamou para por aqui.
   *
   * Vale para os dois lados. A rejeição da NFE-20872-001 estava no retorno e o
   * banco também a tinha; a autorização da NFE-20481-001 estava no retorno e o
   * banco NÃO tinha — a nota seguiu em PROCESSANDO, sem número, sem chave e sem
   * caminhos. Esperar o banco deixaria o operador sem desfecho nos dois casos.
   */
  async function tratarDesfecho(desfecho: DesfechoFocus): Promise<boolean> {
    if (desfecho.tipo === "AUTORIZADO") {
      const danfe = urlDaFocus(desfecho.documentos.caminhoDanfe);
      setPasso("AUTHORIZED");
      setSefazCode(desfecho.codigo);
      setSefazMessage("");
      setErroTecnico("");
      setDanfeDoRetorno(danfe);

      if (danfe && !jaAbriuDanfe.current) {
        jaAbriuDanfe.current = true;
        try {
          window.open(danfe, "_blank");
        } catch (e) {
          console.warn("[EmissaoNfeModal] Pop-up de DANFE bloqueado pelo navegador:", e);
        }
      }

      showToast({ type: "success", title: "NF-e autorizada com sucesso." });

      // Melhor esforço: se o banco já tiver o retorno, a tela usa os dados dele.
      const atualizada = await recarregar();
      if (atualizada) setNotaAtual(atualizada);
      return true;
    }

    if (desfecho.tipo === "REJEITADO") {
      setPasso("ERROR");
      setSefazCode(desfecho.codigo);
      setSefazMessage(desfecho.mensagem);
      setErroTecnico("");
      const atualizada = await recarregar();
      if (atualizada) setNotaAtual(atualizada);
      return true;
    }

    if (desfecho.tipo === "ILEGIVEL") {
      setPasso("ERROR");
      setSefazCode("");
      setSefazMessage("");
      setErroTecnico(desfecho.motivo);
      const atualizada = await recarregar();
      if (atualizada) setNotaAtual(atualizada);
      return true;
    }

    return false;
  }

  async function consultarStatus(marcarPasso = true) {
    if (marcarPasso) {
      setPasso("QUERYING");
      setErroTecnico("");
    }

    try {
      const response = await fetch(WEBHOOK_CONSULTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: notaAtual.ref })
      });

      // A consulta sofre do mesmo mal da emissão: o código HTTP é o da chamada,
      // e a recusa da SEFAZ vem no corpo. Lê-se o corpo antes do banco.
      let corpoConsulta: unknown = null;
      try {
        const texto = await response.clone().text();
        if (texto) {
          try {
            corpoConsulta = JSON.parse(texto);
          } catch {
            corpoConsulta = texto;
          }
        }
      } catch {
        /* sem corpo legível: decide-se pelo banco, como antes */
      }

      const desfecho = lerDesfechoDaFocus(corpoConsulta);
      if (await tratarDesfecho(desfecho)) return;

      const atualizada = (await recarregar()) ?? notaAtual;

      const status = String(atualizada.status || "").toUpperCase();
      const statusFocus = String(atualizada.status_focus || "").toUpperCase();
      const temDanfe = Boolean(atualizada.url_danfe);

      if (status === "AUTORIZADA" || statusFocus === "AUTORIZADO" || temDanfe) {
        setPasso("AUTHORIZED");
        setSefazCode(atualizada.status_sefaz || "");
        setSefazMessage("");
        setErroTecnico("");
        setNotaAtual(atualizada);

        if (atualizada.url_danfe && !jaAbriuDanfe.current) {
          jaAbriuDanfe.current = true;
          try {
            window.open(atualizada.url_danfe, "_blank");
          } catch (e) {
            console.warn("[EmissaoNfeModal] Pop-up de DANFE bloqueado pelo navegador:", e);
          }
        }

        showToast({ type: "success", title: "NF-e autorizada com sucesso." });
        return;
      }

      const ESTADOS_DE_FALHA = ["ERRO_AUTORIZACAO", "REJEITADA", "ERRO_ENVIO", "DENEGADA", "CANCELADA"];
      if (
        ESTADOS_DE_FALHA.includes(status) ||
        ESTADOS_DE_FALHA.includes(statusFocus) ||
        Boolean(atualizada.mensagem_sefaz) ||
        Boolean(atualizada.erro_mensagem)
      ) {
        setPasso("ERROR");
        setSefazCode(atualizada.status_sefaz || "");
        setSefazMessage(atualizada.mensagem_sefaz || atualizada.erro_mensagem || "Rejeição fiscal Sefaz.");
        setErroTecnico("");
        setNotaAtual(atualizada);
        return;
      }

      if (!response.ok) {
        let mensagem = "";
        try {
          const data = await response.json();
          mensagem = String(data.erro || data.error || data.mensagem || data.message || "");
        } catch {
          /* resposta sem JSON: cai na mensagem genérica abaixo */
        }
        throw new Error(mensagem || `Erro na consulta (HTTP ${response.status}).`);
      }

      setPasso("STILL_PROCESSING");
      setSefazCode(atualizada.status_sefaz || "");
      setSefazMessage("");
      setErroTecnico("");
      setNotaAtual(atualizada);
    } catch (err) {
      console.error("[EmissaoNfeModal] Erro ao consultar status:", err);
      setPasso("ERROR");
      setErroTecnico(err instanceof Error ? err.message : "Erro desconhecido ao consultar status.");
      setSefazCode("");
      setSefazMessage("");
      const atualizada = await recarregar();
      if (atualizada) setNotaAtual(atualizada);
    }
  }

  async function emitir() {
    if (String(notaAtual.status || "").toUpperCase() !== "PRONTA_PARA_ENVIO") {
      showToast({ type: "error", title: "Ação não permitida para o status atual da nota." });
      return;
    }

    setPasso("SENDING");
    setErroTecnico("");
    setSefazCode("");
    setSefazMessage("");
    jaAbriuDanfe.current = false;

    try {
      const sessao = await getSupabaseClient()?.auth.getSession();
      const accessToken = sessao?.data?.session?.access_token ?? "";
      if (!accessToken) throw new Error("Sessão expirada. Faça login novamente.");

      const response = await fetch("/api/fiscal/emitir-nfe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ ref: notaAtual.ref })
      });

      if (!response.ok) {
        let mensagem = "Erro na comunicação com o servidor.";
        try {
          const data = await response.json();
          mensagem = data.erro || data.error || data.mensagem || data.message || mensagem;
        } catch {
          try {
            const texto = await response.text();
            if (texto) mensagem = texto;
          } catch {
            /* sem corpo legível: fica a mensagem genérica */
          }
        }
        throw new Error(mensagem);
      }

      // O 200 da rota é o sucesso da CHAMADA. A autorização — ou a recusa — vem
      // dentro do corpo, em `retorno_focus.data`. Rejeição da SEFAZ é falha,
      // mesmo com 201 da Focus.
      const dados = (await response.json().catch(() => null)) as { retorno?: unknown } | null;
      const desfecho = lerDesfechoDaFocus(dados?.retorno);
      if (await tratarDesfecho(desfecho)) return;

      setPasso("SENT_WAITING");

      // Espera fixa herdada do fluxo anterior — tratada em outra rodada.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await consultarStatus();
    } catch (err) {
      console.error("[EmissaoNfeModal] Erro ao emitir NF-e:", err);
      setPasso("ERROR");
      setErroTecnico(err instanceof Error ? err.message : "Erro desconhecido ao enviar nota.");
      setSefazCode("");
      setSefazMessage("");
      const atualizada = await recarregar();
      if (atualizada) setNotaAtual(atualizada);
    }
  }

  const ehErroDeCredencial =
    String(notaAtual.erro_codigo) === "401" ||
    (notaAtual.payload_retorno && (notaAtual.payload_retorno as { statusCode?: number }).statusCode === 401) ||
    String(notaAtual.erro_mensagem || "").toLowerCase().includes("unauthorized") ||
    String(sefazMessage || "").toLowerCase().includes("unauthorized") ||
    String(sefazCode || "") === "401";

  const temDetalheSefaz = Boolean(
    notaAtual.codigo_status_sefaz || notaAtual.status_sefaz || notaAtual.mensagem_sefaz
  );

  const emAndamento = ["SENDING", "SENT_WAITING", "QUERYING"].includes(passo);

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
        {passo === "IDLE" ? (
          <>
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
                <Send className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">Emitir NF-e</h3>
            </div>
            <div className="px-6 pb-6 text-sm text-slate-600 leading-relaxed">
              A nota fiscal com referência{" "}
              <strong className="text-slate-900 font-mono font-semibold">{notaAtual.ref}</strong> será
              transmitida para emissão definitiva. <strong>Esta ação não pode ser desfeita</strong> — uma
              nota autorizada só sai por cancelamento junto à SEFAZ. Deseja prosseguir?
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
              <button
                type="button"
                onClick={onFechar}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void emitir()}
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl shadow-sm transition flex items-center justify-center min-w-[120px]"
              >
                Emitir NF-e
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 pt-6 pb-4 flex items-center gap-3">
              <div
                className={`p-3 rounded-2xl shrink-0 ${
                  passo === "AUTHORIZED"
                    ? "bg-emerald-50 text-emerald-600"
                    : passo === "ERROR"
                    ? "bg-rose-50 text-rose-600"
                    : passo === "STILL_PROCESSING"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-blue-50 text-blue-600"
                }`}
              >
                {passo === "AUTHORIZED" ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : passo === "ERROR" ? (
                  <AlertTriangle className="h-6 w-6" />
                ) : (
                  <Loader2 className="h-6 w-6 animate-spin" />
                )}
              </div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                {passo === "ERROR"
                  ? ehErroDeCredencial
                    ? "Falha de autenticação com a Focus NFe"
                    : temDetalheSefaz
                    ? "NF-e rejeitada pela Sefaz"
                    : "Falha de processamento"
                  : "Acompanhamento de Emissão"}
              </h3>
            </div>

            <div className="px-6 pb-6 text-sm text-slate-600 leading-relaxed space-y-4">
              {passo === "ERROR" ? (
                ehErroDeCredencial ? (
                  <div className="space-y-3">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                          Referência
                        </span>
                        <strong className="text-slate-800 font-mono text-sm">{notaAtual.ref}</strong>
                      </div>
                      <hr className="border-slate-100" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                          Mensagem de erro
                        </span>
                        <span className="text-rose-700 font-mono bg-rose-50/50 p-2.5 rounded-lg border border-rose-100/50 break-words leading-normal block">
                          A nota não chegou à SEFAZ porque a credencial da empresa emissora foi recusada pela
                          Focus.
                        </span>
                      </div>
                    </div>
                    <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-800 space-y-1">
                      <span className="font-bold text-blue-900 block">Orientação:</span>
                      <span>
                        Peça a revisão da credencial Focus da empresa emissora. Depois use{" "}
                        <strong>Consultar status</strong> — se a nota não tiver saído, ela continua pronta
                        para envio.
                      </span>
                    </div>
                  </div>
                ) : temDetalheSefaz ? (
                  (() => {
                    const rejeicao = getSefazRejectionInfo(sefazCode);
                    return (
                      <div className="space-y-3">
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                              Referência
                            </span>
                            <strong className="text-slate-800 font-mono text-sm">{notaAtual.ref}</strong>
                          </div>
                          <hr className="border-slate-100" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                              Código Sefaz
                            </span>
                            <strong className="text-slate-800 font-mono">{sefazCode || "900"}</strong>
                          </div>
                          <hr className="border-slate-100" />
                          <div className="flex flex-col gap-0.5">
                            <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                              Mensagem Sefaz
                            </span>
                            <span className="text-rose-700 font-mono bg-rose-50/50 p-2.5 rounded-lg border border-rose-100/50 break-words leading-normal block">
                              {sefazMessage}
                            </span>
                          </div>
                        </div>
                        <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-900 space-y-2">
                          <div className="flex items-center gap-1.5 font-bold text-blue-950">
                            <span className="text-base">💡</span>
                            <span>{rejeicao.titulo}</span>
                          </div>
                          <div className="text-slate-700 leading-normal">
                            <strong className="text-slate-800 font-medium block mb-1">O que significa:</strong>
                            {rejeicao.explicacao}
                          </div>
                          <hr className="border-blue-100/80 my-2" />
                          <div className="text-slate-700 leading-normal">
                            <strong className="text-slate-800 font-medium block mb-1">Como resolver:</strong>
                            {rejeicao.orientacao}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="space-y-3">
                    <span className="text-rose-700 block font-semibold">Erro Técnico/Comunicação:</span>
                    <p className="text-xs text-rose-600 bg-rose-50/50 p-3 rounded-xl border border-rose-100 break-words font-mono">
                      {sefazMessage || erroTecnico || "Erro de resposta desconhecido."}
                    </p>
                    <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-800 space-y-1">
                      <span className="font-bold text-blue-900 block">O que fazer agora:</span>
                      <span>
                        Não dá para saber daqui se a nota chegou à Focus. Use{" "}
                        <strong>Consultar status</strong> antes de tentar de novo — se ela tiver saído, o
                        reenvio seria bloqueado; se não tiver, a nota continua pronta para envio.
                      </span>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-1.5 font-mono text-xs">
                    <p className="flex justify-between">
                      <span className="text-slate-400">Referência:</span>
                      <strong className="text-slate-800">{notaAtual.ref}</strong>
                    </p>
                    <p className="flex justify-between">
                      <span className="text-slate-400">Status Atual:</span>
                      <strong className="text-slate-800 uppercase">{notaAtual.status}</strong>
                    </p>
                  </div>
                  <div className="text-slate-700 font-medium">
                    {passo === "SENDING" && "Enviando nota para Focus..."}
                    {passo === "SENT_WAITING" && "Nota enviada. Aguardando processamento da Focus..."}
                    {passo === "QUERYING" && "Consultando autorização e documentos fiscais..."}
                    {passo === "AUTHORIZED" && (
                      <span className="text-emerald-700">NF-e autorizada com sucesso.</span>
                    )}
                    {passo === "STILL_PROCESSING" && (
                      <span className="text-amber-700">
                        A NF-e ainda está em processamento. Consulte novamente em alguns instantes.
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-wrap justify-end items-center gap-3">
              {emAndamento ? (
                <span className="text-xs text-slate-400 flex items-center gap-1.5 animate-pulse">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Não feche esta tela...
                </span>
              ) : (
                <>
                  {passo === "AUTHORIZED" && (
                    <>
                      {(notaAtual.url_danfe || danfeDoRetorno) && (
                        <button
                          type="button"
                          onClick={() => {
                            window.open(notaAtual.url_danfe || danfeDoRetorno, "_blank");
                            onFechar();
                          }}
                          className="px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition rounded-xl flex items-center gap-1.5"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir DANFE
                        </button>
                      )}
                      {notaAtual.ref && (
                        <button
                          type="button"
                          onClick={() => {
                            const xmlUrl = `https://pay.ai-ideal.com.br/functions/v1/download-nfe-xml?ref=${encodeURIComponent(
                              notaAtual.ref
                            )}`;
                            window.open(xmlUrl, "_blank");
                            onFechar();
                          }}
                          className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition rounded-xl flex items-center gap-1.5"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Baixar XML
                        </button>
                      )}
                    </>
                  )}

                  {/*
                    Todo desfecho que não é sucesso oferece caminho adiante.
                    "Consultar status" é seguro: relê, não emite. Vale inclusive
                    em falha técnica e em 401, onde antes só havia "Fechar".
                  */}
                  {(passo === "STILL_PROCESSING" || passo === "ERROR") && (
                    <button
                      type="button"
                      onClick={() => void consultarStatus()}
                      className="px-4 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] transition rounded-xl"
                    >
                      Consultar status
                    </button>
                  )}

                  {/*
                    Só navega até a nota — não muda status nenhum. Por isso NÃO
                    se chama "Corrigir rascunho": esse nome pertence à ação do
                    menu, que grava PENDENTE de verdade.
                  */}
                  {passo === "ERROR" && onAbrirNota && (
                    <button
                      type="button"
                      onClick={() => onAbrirNota(notaAtual.id)}
                      className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition rounded-xl"
                    >
                      Abrir a nota
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onFechar}
                    className="px-5 py-2.5 text-xs font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition rounded-xl"
                  >
                    Fechar
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
