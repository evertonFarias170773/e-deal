"use client";

import { useState } from "react";
import {
  aplicarRecotacao,
  buscarLiberacaoAtiva,
  liberarRecotacao,
  recotarFrete,
  type OpcaoRecotacao,
  type RecotacaoResult
} from "@/features/expedicao/services/recotacao.client";

/**
 * Recotar o frete a partir da PROPOSTA — Peça B da Etapa 3.
 *
 * POR QUE EXISTE
 *   A Peça A deu destino à transportadora; faltava o VALOR do frete. Depois de
 *   LIBERADO a proposta é somente leitura para frete, e a trava é do banco:
 *   salvar o orçamento reescreve `cotacao_frete` e os três triggers de lá
 *   rebaixam o pedido para NOVO. A recotação é o único mecanismo que altera o
 *   frete de um pedido em produção sem derrubá-lo — ela escreve direto em
 *   `propostas.valor_frete` e `valor_total`, por RPC, sem tocar `cotacao_frete`.
 *
 *   Até aqui esse mecanismo só tinha entrada pelo modal de Despachar. Quem abria
 *   a proposta para consertar via o aviso de somente-leitura e parava.
 *
 * NADA DE MECANISMO NOVO
 *   Reusa `recotacao.client.ts` inteiro — as mesmas rotas e a mesma RPC do
 *   despacho, sem uma linha alterada. A entrada do modal continua existindo: as
 *   duas convivem até a Etapa 3 fechar.
 *
 * A CHAVE NASCE POR OPÇÃO, QUANDO A COTAÇÃO CHEGA — nunca no clique. É a
 *   idempotência: repetir a mesma chave devolve o registro anterior sem gravar
 *   de novo. Mesmo desenho do modal.
 *
 * O QUE A RPC EXIGE, E QUE ESTE PAINEL NÃO CONTORNA
 *   `status_interno = 'EXPEDICAO'`, modalidade CIF, proposta não avulsa, com
 *   pagamento confirmado, não entregue, sem rastreio emitido — e uma liberação
 *   ativa de admin. Todos revalidados no servidor; a tela só evita a ida à toa.
 */

type Props = {
  idInt: number;
  /** `propostas.status_interno`. A RPC só aceita EXPEDICAO. */
  statusInterno: string | null | undefined;
  /** Modalidade da proposta. A RPC só aceita CIF. */
  modalidade: string | null | undefined;
  /** Chamado depois de aplicar, para a tela recarregar o frete novo. */
  onAplicado?: (freteNovo: number, totalNovo: number) => void;
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function RecotarFreteAdminPanel({ idInt, statusInterno, modalidade, onAplicado }: Props) {
  const [liberacao, setLiberacao] = useState<{ liberadoEm: string; liberadoPorNome: string | null } | null>(null);
  const [liberando, setLiberando] = useState(false);
  const [recotando, setRecotando] = useState(false);
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [recotacao, setRecotacao] = useState<RecotacaoResult | null>(null);
  const [chavesPorOpcao, setChavesPorOpcao] = useState<Record<string, string>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const emExpedicao = String(statusInterno ?? "").trim() === "EXPEDICAO";
  const ehCif = String(modalidade ?? "").trim().toUpperCase() === "CIF";
  const elegivel = emExpedicao && ehCif;

  // A liberação é buscada SOB DEMANDA, no clique — não num efeito de montagem.
  // Duas razões: evita uma consulta por proposta aberta só para desenhar um selo
  // que quase nunca aparece, e mantém este componente sem `setState` dentro de
  // efeito, que é justamente o padrão que o lint desta base persegue.
  async function carregarLiberacao() {
    const atual = await buscarLiberacaoAtiva(idInt);
    setLiberacao(atual);
    return atual;
  }

  // Fora de EXPEDICAO ou fora de CIF a RPC recusa — dizer o porquê aqui evita
  // um clique que só produziria erro de servidor.
  if (!elegivel) {
    return (
      <p className="text-[11px] text-amber-800 dark:text-amber-300">
        Recotar o frete só vale com o pedido em EXPEDICAO e modalidade CIF
        {statusInterno ? ` (agora: ${statusInterno}` : " (agora: sem status"}
        {modalidade ? `, ${modalidade}).` : ", sem modalidade)."}
      </p>
    );
  }

  async function handleLiberar() {
    setLiberando(true);
    setErro(null);
    const res = await liberarRecotacao(idInt, "Liberado pela proposta");
    setLiberando(false);
    if (!res.success) {
      setErro(res.errorMessage || "Não foi possível liberar.");
      return;
    }
    await carregarLiberacao();
  }

  async function handleRecotar() {
    setRecotando(true);
    setErro(null);
    setMensagem(null);

    // Sem liberacao ativa a RPC recusa com EXP_RECOT_SEM_LIBERACAO. Conferir
    // aqui troca esse erro por um botao de liberar, que e o que falta de fato.
    const ativa = liberacao ?? (await carregarLiberacao());
    if (!ativa) {
      setRecotando(false);
      setErro("Esta recotacao ainda nao foi liberada. Use \"Liberar recotacao\" acima e tente de novo.");
      return;
    }

    const res = await recotarFrete(idInt);
    setRecotando(false);
    if (!res.success) {
      setRecotacao(null);
      setChavesPorOpcao({});
      setErro(res.errorMessage || "Não foi possível recotar agora.");
      return;
    }
    setRecotacao(res);
    const chaves: Record<string, string> = {};
    for (const o of res.opcoes ?? []) chaves[o.id] = crypto.randomUUID();
    setChavesPorOpcao(chaves);
  }

  /**
   * Só entra o que barateia ou empata: a RPC levanta `EXP_RECOT_ENCARECE` e o
   * CHECK `exp_recot_dif_etapa2_ck` recusa `diferenca > 0`. A tela repete o gate
   * para explicar em vez de deixar o servidor recusar sem contexto.
   */
  function podeAplicar(o: OpcaoRecotacao): boolean {
    return o.diferenca <= 0;
  }

  async function handleAplicar(o: OpcaoRecotacao) {
    const chave = chavesPorOpcao[o.id];
    if (!chave) {
      setErro("Recote antes de aplicar.");
      return;
    }
    setAplicandoId(o.id);
    setErro(null);
    const res = await aplicarRecotacao({ idInt, chave, opcaoId: o.id, valorVisto: o.valor });
    setAplicandoId(null);
    if (!res.success) {
      setErro(res.errorMessage || "Não foi possível aplicar.");
      return;
    }
    // A aplicação consome a liberação na mesma transação: refletir aqui evita o
    // selo continuar dizendo "liberado" depois de gasto.
    if (!res.idempotente) setLiberacao(null);
    setRecotacao(null);
    setChavesPorOpcao({});
    setMensagem(
      res.idempotente
        ? "Essa opção já tinha sido aplicada — nada foi gravado de novo."
        : `Frete atualizado: ${brl(res.freteAnterior ?? 0)} → ${brl(res.freteNovo ?? 0)}. ` +
          `Total do pedido: ${brl(res.totalAnterior ?? 0)} → ${brl(res.totalNovo ?? 0)}.`
    );
    if (!res.idempotente && onAplicado) {
      onAplicado(Number(res.freteNovo ?? 0), Number(res.totalNovo ?? 0));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {liberacao ? (
          <span className="rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            Liberado{liberacao.liberadoPorNome ? ` por ${liberacao.liberadoPorNome}` : ""}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void handleLiberar()}
            disabled={liberando}
            className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:bg-slate-900 dark:text-amber-200"
          >
            {liberando ? "Liberando…" : "Liberar recotação"}
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleRecotar()}
          disabled={recotando}
          className="rounded-xl bg-[#0b2f4a] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0b2f4a]/90 disabled:opacity-50"
        >
          {recotando ? "Cotando…" : "Recotar frete"}
        </button>
      </div>

      {recotacao?.success && (
        <div className="space-y-1">
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            Frete hoje: <strong>{brl(recotacao.freteAtual ?? 0)}</strong>
            {recotacao.endereco ? ` · ${recotacao.endereco.cidade}/${recotacao.endereco.uf}` : ""}
            {recotacao.pesoGramas ? ` · ${(recotacao.pesoGramas / 1000).toFixed(3)} kg` : ""}
          </p>
          {(recotacao.opcoes ?? []).map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 dark:border-amber-900 dark:bg-slate-900"
            >
              <span className="text-xs font-medium">
                {o.transportadora} · {o.servico} — <strong>{brl(o.valor)}</strong>{" "}
                <span className={o.diferenca <= 0 ? "text-emerald-700" : "text-rose-700"}>
                  ({o.diferenca <= 0 ? "" : "+"}
                  {brl(o.diferenca)})
                </span>
              </span>
              <button
                type="button"
                onClick={() => void handleAplicar(o)}
                disabled={!podeAplicar(o) || aplicandoId !== null}
                title={podeAplicar(o) ? undefined : "Encarece: nesta etapa só entra o que barateia ou empata."}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {aplicandoId === o.id ? "Aplicando…" : "Aplicar"}
              </button>
            </div>
          ))}
          {(recotacao.opcoes ?? []).length === 0 && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">Nenhuma opção cotada agora.</p>
          )}
        </div>
      )}

      {mensagem && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {mensagem}
        </p>
      )}
      {erro && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {erro}
        </p>
      )}
    </div>
  );
}
