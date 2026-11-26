"use client";

import { useState } from "react";
import {
  aplicarRecotacaoAbonando,
  recotarFrete,
  type OpcaoRecotacao,
  type RecotacaoResult
} from "@/features/expedicao/services/recotacao.client";
import { ConfirmarAbonoModal, type ModoDaTroca } from "@/features/expedicao/components/ConfirmarAbonoModal";
import { avisoCceDoAbono, type FormaCobrancaTroca } from "@/features/expedicao/lib/abono-frete";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * TROCAR A TRANSPORTADORA ABONANDO A DIFERENÇA, pela aba Fretes (26/11/2026).
 *
 * Na aba Fretes, trocar de card muda o frete e o total — é a troca com cobrança,
 * e ela tem as barreiras dela (NF-e, despacho). A recotação da Expedição, com a
 * liberação de ADM, não existe aqui desde 14/09/2026. Por isso a liberação dada
 * no Despachar não aparecia nesta aba: são dois caminhos.
 *
 * Este quadro é o abono nos dois caminhos: recota pela mesma rota do Despachar e
 * aplica a opção que ENCARECE sem mudar o frete cobrado nem o total
 * (`exp_aplicar_recotacao_abono`). Só aparece para quem tem
 * `frete.trocar_abonando` (PermissionGuard na página); o servidor confere de novo.
 *
 * TROCAR COBRANDO A DIFERENÇA (26/11/2026): ao lado do abono, a mesma troca com
 * a diferença cobrada à parte (`exp_aplicar_recotacao_cobrando`): cobrança nova
 * do pedido, fora do total, sem nota complementar; o despacho espera o pagamento.
 */
export function TrocarAbonandoPanel({
  idInt,
  statusInterno,
  modalidade,
  temNotaAutorizada,
  onTrocado
}: {
  idInt: number;
  statusInterno: string | null | undefined;
  modalidade: string | null | undefined;
  temNotaAutorizada: boolean;
  /** Recarrega a proposta: a transportadora mudou. */
  onTrocado?: () => void;
}) {
  const [recotando, setRecotando] = useState(false);
  const [recotacao, setRecotacao] = useState<RecotacaoResult | null>(null);
  const [chaves, setChaves] = useState<Record<string, string>>({});
  const [escolhida, setEscolhida] = useState<OpcaoRecotacao | null>(null);
  const [modo, setModo] = useState<ModoDaTroca>("ABONO");
  const [trocando, setTrocando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const emExpedicao = String(statusInterno ?? "").trim() === "EXPEDICAO";
  const ehCif = String(modalidade ?? "").trim().toUpperCase() === "CIF";
  if (!emExpedicao || !ehCif) {
    return (
      <p className="text-[11px] text-slate-600 dark:text-slate-300">
        Trocar abonando ou cobrando a diferença só vale com o pedido em EXPEDICAO, em CIF e antes do despacho
        {statusInterno ? ` (agora: ${statusInterno}` : " (agora: sem status"}
        {modalidade ? `, ${modalidade}).` : ", sem modalidade)."}
      </p>
    );
  }

  async function handleRecotar() {
    setRecotando(true);
    setErro(null);
    setMensagem(null);
    setAviso(null);
    const res = await recotarFrete(idInt);
    setRecotando(false);
    if (!res.success) {
      setRecotacao(null);
      setErro(res.errorMessage || "Não foi possível recotar agora.");
      return;
    }
    setRecotacao(res);
    const novas: Record<string, string> = {};
    for (const o of res.opcoes ?? []) novas[o.id] = crypto.randomUUID();
    setChaves(novas);
  }

  async function confirmar(motivo: string, tipoCobranca: FormaCobrancaTroca) {
    if (!escolhida) return;
    const chave = chaves[escolhida.id];
    if (!chave) {
      setErro("Recote antes de trocar.");
      return;
    }
    setTrocando(true);
    setErro(null);
    const res = await aplicarRecotacaoAbonando({
      idInt,
      chave,
      opcaoId: escolhida.id,
      valorVisto: escolhida.valor,
      motivo,
      modo,
      tipoCobranca
    });
    setTrocando(false);
    if (!res.success) {
      setErro(res.errorMessage || `Não foi possível trocar ${modo === "COBRANDO" ? "cobrando" : "abonando"}.`);
      return;
    }
    setEscolhida(null);
    setRecotacao(null);
    setChaves({});
    setMensagem(
      res.idempotente
        ? "Essa troca já tinha sido feita — nada foi gravado de novo."
        : res.cobrando
          ? `Transportadora trocada para ${res.transportadora}. Frete da proposta: ${brl(res.freteNovo ?? 0)} (não mudou). ` +
            `Cobrança nova ${res.cobranca?.id_pagamento ?? ""} de ${brl(res.cobrancaValor ?? 0)}, à parte: gere o PIX, o boleto ou o ` +
            `link do cartão na aba Pagamentos. O despacho espera o pagamento. Total do pedido: ${brl(res.totalNovo ?? 0)} (não mudou).`
          : `Transportadora trocada para ${res.transportadora}. Frete do cliente: ${brl(res.freteNovo ?? 0)} (não mudou). ` +
            `Abonado: ${brl(res.abonoValor ?? 0)}. Total do pedido: ${brl(res.totalNovo ?? 0)} (não mudou).`
    );
    setAviso(avisoCceDoAbono(res.notasAutorizadas, res.transportadora ?? escolhida.transportadora));
    if (!res.idempotente) onTrocado?.();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleRecotar()}
        disabled={recotando}
        className="rounded-xl bg-[#0b2f4a] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0b2f4a]/90 disabled:opacity-50"
      >
        {recotando ? "Cotando…" : "Recotar para trocar a transportadora"}
      </button>

      {recotacao?.success && (
        <div className="space-y-1">
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            Frete que o cliente paga: <strong>{brl(recotacao.freteAtual ?? 0)}</strong>
            {recotacao.endereco ? ` · ${recotacao.endereco.cidade}/${recotacao.endereco.uf}` : ""}
          </p>
          {(recotacao.opcoes ?? []).map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="text-xs font-medium">
                {o.transportadora} · {o.servico} — <strong>{brl(o.valor)}</strong>{" "}
                <span className={o.diferenca <= 0 ? "text-emerald-700" : "text-rose-700"}>
                  ({o.diferenca <= 0 ? "" : "+"}
                  {brl(o.diferenca)})
                </span>
              </span>
              {o.diferenca > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setModo("ABONO");
                      setEscolhida(o);
                    }}
                    disabled={trocando}
                    className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    Trocar abonando {brl(o.diferenca)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModo("COBRANDO");
                      setEscolhida(o);
                    }}
                    disabled={trocando}
                    className="rounded-lg bg-sky-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-800 disabled:opacity-40"
                  >
                    Trocar cobrando {brl(o.diferenca)}
                  </button>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500" title="O que barateia ou empata se aplica no Despachar da Expedição, com liberação de ADM.">
                  Não encarece
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {mensagem && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {mensagem}
        </p>
      )}
      {aviso && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {aviso}
        </p>
      )}
      {erro && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {erro}
        </p>
      )}
      {escolhida ? (
        <ConfirmarAbonoModal
          modo={modo}
          transportadora={escolhida.transportadora}
          servico={escolhida.servico}
          valorOpcao={escolhida.valor}
          freteAtual={recotacao?.freteAtual ?? 0}
          temNotaAutorizada={temNotaAutorizada}
          salvando={trocando}
          onConfirmar={(motivo, tipoCobranca) => void confirmar(motivo, tipoCobranca)}
          onClose={() => setEscolhida(null)}
        />
      ) : null}
    </div>
  );
}
