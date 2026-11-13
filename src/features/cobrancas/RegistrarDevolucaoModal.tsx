"use client";

/**
 * Janela "Registrar devolução e cancelar pedido" (13/11/2026, caso 25098).
 *
 * Abre pela Conferência, pela lista de Pedidos e pela aba Pagamentos. Só super
 * admin vê a ação (quem chama confere com `podeRegistrarDevolucao`), e a função
 * do banco confere de novo. O Vibe não devolve dinheiro: a devolução é feita no
 * aplicativo do banco, e aqui ela só é registrada.
 *
 * Recebe o pedido e, quando quem abriu já sabe, a cobrança. Sem a cobrança, lê
 * as cobranças do pedido e oferece as pagas em dinheiro.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Undo2, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  cobrancaAceitaDevolucao,
  confirmadoEmMesFechado,
  dataCivilSaoPaulo,
  normalizarE2e,
  problemaNosCampos
} from "@/features/cobrancas/lib/devolucao-pagamento";

type CobrancaLida = {
  id: string;
  id_pagamento: string | null;
  status: string | null;
  tipo_cobranca: string | null;
  valor: number;
  paid_at: string | null;
  data_confirmacao: string | null;
};

interface RegistrarDevolucaoModalProps {
  aberto: boolean;
  idInt: number;
  /** Cobrança já escolhida (aba Pagamentos e Conferência). */
  idCobranca?: string | null;
  onFechar: () => void;
  /** Depois de gravar: quem abriu recarrega a lista. */
  onConcluido?: () => void;
}

const ROTULO_TIPO: Record<string, string> = {
  PIX: "PIX",
  "E-PIX": "PIX",
  BOLETO: "Boleto",
  CARD_PARCELADO: "Cartão de crédito",
  CREDIT_CARD: "Cartão de crédito"
};

export function RegistrarDevolucaoModal({ aberto, idInt, idCobranca, onFechar, onConcluido }: RegistrarDevolucaoModalProps) {
  const { showToast } = useAppToast();
  const hoje = dataCivilSaoPaulo(new Date()) ?? "";

  // Quem abre monta a janela só quando ela abre: os campos nascem limpos.
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [cobrancas, setCobrancas] = useState<CobrancaLida[]>([]);
  const [escolhida, setEscolhida] = useState<string>("");
  const [dataDevolucao, setDataDevolucao] = useState(hoje);
  const [e2eId, setE2eId] = useState("");
  const [comprovante, setComprovante] = useState("");
  const [motivo, setMotivo] = useState("");
  const [confirmaMesFechado, setConfirmaMesFechado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const client = getSupabaseClient();
    let vivo = true;
    void (async () => {
      if (!client) {
        await Promise.resolve();
        if (!vivo) return;
        setCarregando(false);
        setErroLeitura("Sistema indisponível no momento.");
        return;
      }
      const { data, error } = await client
        .from("pagamentos_v2")
        .select("id, id_pagamento, status, tipo_cobranca, valor, paid_at, data_confirmacao")
        .eq("id_int", idInt);
      if (!vivo) return;
      setCarregando(false);
      if (error) {
        setErroLeitura(`Não foi possível ler as cobranças do pedido: ${error.message}`);
        return;
      }
      const pagas = ((data ?? []) as CobrancaLida[])
        .map((c) => ({ ...c, valor: Number(c.valor) }))
        .filter((c) => cobrancaAceitaDevolucao(c))
        .filter((c) => !idCobranca || c.id === idCobranca);
      setCobrancas(pagas);
      if (pagas.length === 1) setEscolhida(pagas[0].id);
    })();
    return () => {
      vivo = false;
    };
  }, [aberto, idInt, idCobranca]);

  const cobranca = useMemo(() => cobrancas.find((c) => c.id === escolhida) ?? null, [cobrancas, escolhida]);
  const mesFechado = cobranca ? confirmadoEmMesFechado(cobranca.data_confirmacao) : false;
  const problema = cobranca
    ? problemaNosCampos({ dataDevolucao, e2eId, comprovante, motivo }, hoje, dataCivilSaoPaulo(cobranca.paid_at))
    : "Escolha a cobrança devolvida.";
  const podeEnviar = !enviando && !problema && (!mesFechado || confirmaMesFechado);

  if (!aberto) return null;

  async function confirmar() {
    if (!cobranca || !podeEnviar) return;
    setEnviando(true);
    setRecusa(null);
    try {
      const resposta = await fetchComSessao("/api/cobrancas/registrar-devolucao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idPagamento: cobranca.id,
          valor: cobranca.valor,
          dataDevolucao,
          e2eId: normalizarE2e(e2eId),
          comprovante: comprovante.trim(),
          motivo: motivo.trim(),
          confirmaMesFechado
        })
      });
      const json = (await resposta.json().catch(() => ({}))) as { success?: boolean; message?: string; jaRegistrada?: boolean };
      if (!resposta.ok || !json.success) {
        setRecusa(json.message || "Não foi possível registrar a devolução. Nada foi alterado.");
        return;
      }
      showToast({
        type: "success",
        title: json.jaRegistrada ? "Esta devolução já estava registrada." : "Devolução registrada e pedido cancelado.",
        description: `Pedido #${idInt}: cobrança ${cobranca.id_pagamento ?? ""} de ${formatCurrency(cobranca.valor)} saiu do faturamento.`
      });
      onConcluido?.();
      onFechar();
    } catch (err) {
      setRecusa(
        err instanceof SessaoExpiradaError
          ? "Sua sessão expirou. Entre de novo e repita."
          : "Falha de comunicação. Confira no Histórico do pedido antes de tentar de novo."
      );
    } finally {
      setEnviando(false);
    }
  }

  const campo =
    "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 disabled:bg-slate-100";

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="titulo-devolucao">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 id="titulo-devolucao" className="text-xl font-semibold text-slate-950">Registrar devolução e cancelar pedido</h2>
            <p className="text-sm text-slate-500 mt-1">Pedido #{idInt}. Essa ação é irreversível.</p>
          </div>
          <button type="button" onClick={onFechar} disabled={enviando} aria-label="Fechar" className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          O Vibe <strong>não devolve o dinheiro</strong>. Faça a devolução no aplicativo do banco antes e registre aqui os dados dela.
          Ao confirmar, a cobrança e o pedido são cancelados e o valor sai do faturamento, das vendas, da comissão e do Dashboard.
        </div>

        {carregando ? (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" /> Lendo as cobranças do pedido...
          </div>
        ) : erroLeitura ? (
          <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" /> {erroLeitura}
          </div>
        ) : cobrancas.length === 0 ? (
          <div className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            Este pedido não tem cobrança paga em dinheiro (PIX, boleto ou cartão) para devolver.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dev-cobranca" className="text-[13px] font-semibold text-slate-800">Cobrança devolvida *</label>
              <select id="dev-cobranca" value={escolhida} onChange={(e) => setEscolhida(e.target.value)} disabled={enviando || cobrancas.length === 1} className={campo}>
                {cobrancas.length > 1 ? <option value="">Selecione...</option> : null}
                {cobrancas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.id_pagamento ?? c.id.slice(0, 8))} · {ROTULO_TIPO[String(c.tipo_cobranca ?? "").toUpperCase()] ?? c.tipo_cobranca} · {formatCurrency(c.valor)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-slate-800">Valor devolvido</span>
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                  {cobranca ? formatCurrency(cobranca.valor) : "—"}
                </p>
                <span className="text-[11px] text-slate-500">Sempre o valor total da cobrança.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dev-data" className="text-[13px] font-semibold text-slate-800">Data da devolução *</label>
                <input id="dev-data" type="date" value={dataDevolucao} max={hoje} onChange={(e) => setDataDevolucao(e.target.value)} disabled={enviando} className={campo} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="dev-e2e" className="text-[13px] font-semibold text-slate-800">e2eId da devolução</label>
              <input id="dev-e2e" type="text" value={e2eId} onChange={(e) => setE2eId(e.target.value)} disabled={enviando} placeholder="32 letras e números, do comprovante do banco" className={`${campo} font-mono`} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dev-comprovante" className="text-[13px] font-semibold text-slate-800">Identificação do comprovante</label>
              <input id="dev-comprovante" type="text" value={comprovante} onChange={(e) => setComprovante(e.target.value)} disabled={enviando} placeholder="Ex.: autenticação ou número da operação no app do banco" className={campo} autoComplete="off" />
              <span className="text-[11px] text-slate-500">Preencha o e2eId, o comprovante ou os dois.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dev-motivo" className="text-[13px] font-semibold text-slate-800">Motivo *</label>
              <textarea id="dev-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enviando} placeholder="Por que o pedido foi cancelado e o valor devolvido" className={campo} />
            </div>

            {mesFechado ? (
              <label className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <input type="checkbox" checked={confirmaMesFechado} onChange={(e) => setConfirmaMesFechado(e.target.checked)} disabled={enviando} className="mt-0.5" />
                Este pagamento foi confirmado em mês anterior. Confirmo que o faturamento já fechado daquele mês vai mudar.
              </label>
            ) : null}

            {problema && cobranca ? <p className="text-xs font-semibold text-slate-600">{problema}</p> : null}
            {recusa ? (
              <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800" role="alert">
                <AlertCircle className="h-5 w-5 shrink-0" /> {recusa}
              </div>
            ) : null}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onFechar} disabled={enviando} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Voltar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={!podeEnviar || !cobranca} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Registrar devolução e cancelar pedido
          </button>
        </div>
      </div>
    </div>
  );
}
