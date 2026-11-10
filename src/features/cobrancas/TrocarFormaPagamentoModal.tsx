"use client";

import { useEffect, useState } from "react";
import { X, AlertCircle, Ban, Loader2, Repeat } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/formatters/currency";
import { listarModelosCobranca } from "@/features/cobrancas/services/modelos-cobranca";
import type { ModeloCobranca } from "@/features/cobrancas/types";
import type { DestinoDaTroca, TipoDestinoDaTroca } from "@/features/cobrancas/troca-forma-pagamento";

/**
 * Trocar forma de pagamento: PIX não pago -> forma interna (Faturado,
 * E-Permuta, E-Amostra, E-Retrabalho), mesma proposta, mesmo valor e mesmo
 * pagador. Quem decide se pode, e para quais formas, é o servidor
 * (GET /api/cobrancas/trocar-forma-pagamento), consultado ao abrir; a tela só
 * escolhe a forma, a condição (quando a forma pede) e o motivo.
 */
type Props = {
  cobrancaId: string;
  onClose: () => void;
  onSuccess?: () => void;
};

type Avaliacao = {
  pode: boolean;
  code?: string;
  message?: string;
  notaAutorizada?: boolean;
  idPagamento?: string | null;
  valor?: number;
  destinos?: DestinoDaTroca[];
};

/** O que muda no resumo "Ao confirmar" conforme a forma escolhida. */
function depoisDaTroca(destino: DestinoDaTroca): string {
  switch (destino.tipo) {
    case "E-FATURADO":
      return "O Faturado segue o caminho de sempre: análise de crédito, Conferência e títulos no Registro de recebíveis.";
    case "E-PERMUTA":
      return "A E-Permuta segue o caminho da família faturado: liberação pelo financeiro e depois a Conferência. Não gera títulos.";
    default:
      return `A ${destino.rotulo} é cortesia, sem condição de pagamento: segue para liberação pelo financeiro e depois para a Conferência.`;
  }
}

async function tokenDaSessao(): Promise<string> {
  const client = getSupabaseClient();
  if (!client) throw new Error("Sistema indisponível no momento.");
  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token || "";
  if (!token) throw new Error("Sessão não encontrada. Faça login novamente.");
  return token;
}

/** Mesma liberação automática do Gerar cobrança. Falha deixa o faturado em análise. */
async function acionarLiberacaoAutomatica(token: string, cobrancaId: string): Promise<boolean> {
  try {
    const resposta = await fetch("/api/cobrancas/aprovar-faturado-automatico", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cobrancaId })
    });
    const dados = await resposta.json().catch(() => null);
    return resposta.ok && dados?.success === true && dados?.aprovadoAutomaticamente === true;
  } catch {
    return false;
  }
}

export function TrocarFormaPagamentoModal({ cobrancaId, onClose, onSuccess }: Props) {
  const { showToast } = useAppToast();
  const { refreshCobrancas } = useCobrancas();

  const [avaliacao, setAvaliacao] = useState<Avaliacao | null>(null);
  const [erroAvaliacao, setErroAvaliacao] = useState<string | null>(null);
  const [modelos, setModelos] = useState<ModeloCobranca[]>([]);
  const [modeloId, setModeloId] = useState("");
  const [tipo, setTipo] = useState<TipoDestinoDaTroca>("E-FATURADO");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const token = await tokenDaSessao();
        const [resposta, lista] = await Promise.all([
          fetch(`/api/cobrancas/trocar-forma-pagamento?id=${encodeURIComponent(cobrancaId)}`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          listarModelosCobranca()
        ]);
        const dados = await resposta.json().catch(() => null);
        if (!ativo) return;
        setModelos(lista);
        if (!resposta.ok || !dados?.success) {
          setErroAvaliacao(dados?.message || "Não foi possível verificar se a forma de pagamento pode ser trocada.");
          return;
        }
        const lida = dados as Avaliacao;
        setAvaliacao(lida);
        const primeiro = lida.destinos?.[0]?.tipo;
        if (primeiro) setTipo(primeiro);
      } catch (err) {
        if (ativo) setErroAvaliacao(err instanceof Error ? err.message : "Erro desconhecido.");
      }
    })();
    return () => {
      ativo = false;
    };
  }, [cobrancaId]);

  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  const carregando = !avaliacao && !erroAvaliacao;
  const destinos = avaliacao?.destinos ?? [];
  const destino = destinos.find((d) => d.tipo === tipo) ?? null;
  const podeConfirmar =
    avaliacao?.pode === true &&
    destino !== null &&
    (!destino.exigeCondicao || Boolean(modeloId)) &&
    motivo.trim().length > 0 &&
    !enviando;

  async function confirmar() {
    if (!podeConfirmar) return;
    setEnviando(true);
    try {
      const token = await tokenDaSessao();
      const resposta = await fetch("/api/cobrancas/trocar-forma-pagamento", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: cobrancaId,
          tipo: destino?.tipo,
          id_modelo_cobranca: destino?.exigeCondicao ? modeloId : null,
          motivo: motivo.trim()
        })
      });
      const dados = await resposta.json().catch(() => null);
      if (!resposta.ok || !dados?.success) {
        showToast({
          type: "error",
          title: "Forma de pagamento não trocada",
          description: dados?.message || "Não foi possível trocar a forma de pagamento."
        });
        void refreshCobrancas();
        return;
      }
      // A liberação automática só vale para o Faturado (como no Gerar cobrança).
      const ehFaturado = destino?.tipo === "E-FATURADO";
      const liberado = ehFaturado && dados.nova?.id ? await acionarLiberacaoAutomatica(token, dados.nova.id) : false;
      const rotulo = destino?.rotulo ?? "Faturado";
      showToast({
        type: "success",
        title: "Forma de pagamento trocada",
        description: liberado
          ? "O PIX foi cancelado e o Faturado foi liberado automaticamente. Ele segue para a Conferência."
          : ehFaturado
            ? "O PIX foi cancelado e o Faturado foi enviado para análise financeira."
            : `O PIX foi cancelado e a ${rotulo} foi criada. Ela aguarda a liberação do financeiro.`
      });
      await refreshCobrancas();
      onSuccess?.();
      onClose();
    } catch (err) {
      showToast({ type: "error", title: "Erro inesperado", description: err instanceof Error ? err.message : "Erro desconhecido." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Trocar forma de pagamento</h2>
            <p className="text-sm text-slate-500 mt-1">PIX para outra forma, mesmo valor e mesma proposta.</p>
          </div>
          <button type="button" onClick={onClose} disabled={enviando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {carregando ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-600 flex gap-3 items-center">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
              <p className="text-xs">Verificando se a forma de pagamento pode ser trocada...</p>
            </div>
          ) : erroAvaliacao ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold">Não foi possível verificar</p>
                <p className="mt-1 leading-relaxed">{erroAvaliacao}</p>
              </div>
            </div>
          ) : avaliacao && !avaliacao.pode ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 flex gap-3 items-start">
              <Ban className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold">Não é possível trocar agora</p>
                <p className="mt-1 leading-relaxed">{avaliacao.message}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">
                  Nova forma de pagamento <span className="text-red-500">*</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {destinos.map((d) => {
                    const marcada = d.tipo === tipo;
                    return (
                      <button
                        key={d.tipo}
                        type="button"
                        onClick={() => setTipo(d.tipo)}
                        disabled={enviando}
                        aria-pressed={marcada}
                        className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                          marcada ? "border-[#0f9f9a] bg-[#dff8f6] text-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {d.rotulo}
                      </button>
                    );
                  })}
                </div>
              </div>

              {destino ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
                  <p className="text-xs font-semibold text-slate-900">Ao confirmar</p>
                  <ul className="mt-1.5 space-y-1 text-xs leading-relaxed list-disc pl-4">
                    <li>
                      Nasce uma cobrança {destino.rotulo} de {formatCurrency(Number(avaliacao?.valor ?? 0))}, com o mesmo pagador.
                    </li>
                    <li>
                      Depois, o PIX {avaliacao?.idPagamento ?? ""} é cancelado no banco. Se o banco não confirmar, o PIX continua
                      ativo e a {destino.rotulo} é cancelada.
                    </li>
                    {avaliacao?.notaAutorizada ? (
                      <li>A nota fiscal autorizada continua como está. Se precisar, o financeiro faz a carta de correção.</li>
                    ) : null}
                    <li>{depoisDaTroca(destino)}</li>
                  </ul>
                </div>
              ) : null}

              {destino?.exigeCondicao ? (
              <div className="space-y-1.5">
                <label htmlFor="troca_condicao" className="text-xs font-semibold text-slate-700">
                  Condição de pagamento <span className="text-red-500">*</span>
                </label>
                <select
                  id="troca_condicao"
                  value={modeloId}
                  onChange={(e) => setModeloId(e.target.value)}
                  disabled={enviando}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0b7774] focus:ring-4 focus:ring-teal-100 disabled:opacity-50"
                >
                  <option value="">Selecione...</option>
                  {modelos
                    .filter((m) => m.resultado && m.qtd_parcela != null && m.inicio != null && m.intervalo != null)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.resultado}
                      </option>
                    ))}
                </select>
              </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="troca_motivo" className="text-xs font-semibold text-slate-700">
                  Motivo da troca <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="troca_motivo"
                  rows={3}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  disabled={enviando}
                  placeholder="Ex.: cliente paga faturado"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0b7774] focus:ring-4 focus:ring-teal-100 disabled:opacity-50"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={!podeConfirmar}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0b7774] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#095f5d] disabled:opacity-50"
          >
            <Repeat className="h-4 w-4" />
            {enviando ? "Trocando..." : "Confirmar troca"}
          </button>
        </div>
      </div>
    </div>
  );
}
