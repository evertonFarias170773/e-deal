/**
 * Confere o Nº final dos lotes ANTES de gravar (29/10/2026).
 *
 * Quem grava lote — a rota da grade (`lotes-em-massa`) e o Salvar da proposta
 * (`saveProposta`, que o `editar-paga` também usa) — gravava o Nº final que a
 * tela mandava. Seis modelos Ticket saíram com Nº final = QTD porque a tela
 * calculou com ×1. Aqui a conta é refeita pelo cadastro do numerador
 * (`producao_numeracoes`), e a gravação inteira é recusada quando diverge.
 *
 * A regra em si é pura e mora em `numeracao-modelo-utils` (`conferirFimDosLotes`):
 * só linha nova ou com QTD, Nº inicial ou numerador diferente do banco é
 * conferida. Este módulo só lê o que ela precisa. Leitura que falha recusa a
 * gravação: sem o cadastro não há como saber se o número está certo.
 *
 * CORREÇÃO DA LINHA INTOCADA (29/10/2026): devolve também, em `correcoes`, as
 * linhas já gravadas em que ninguém mexeu e cujo Nº final difere da conta do
 * numerador de hoje (`correcoesDoFimIntocado`, a mesma comparação do aviso
 * "gravado × calculado"). Quem aplica é o Salvar da proposta; a rota da grade
 * só confere.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  conferirFimDosLotes,
  correcoesDoFimIntocado,
  loteFoiTocado,
  mensagemDaRecusaDoFim,
  type CorrecaoDoFim,
  type FimRecusado,
  type LoteGravadoParaConferir,
  type LoteParaConferirFim,
  type NumeracaoOpcao
} from "@/features/orcamentos/numeracao-modelo-utils";

export type ConferenciaDoFim =
  | { ok: true; correcoes: CorrecaoDoFim[] }
  | { ok: false; mensagem: string; recusas: FimRecusado[] };

export async function conferirFimAntesDeGravar(
  client: SupabaseClient,
  lotes: readonly LoteParaConferirFim[]
): Promise<ConferenciaDoFim> {
  if (lotes.length === 0) return { ok: true, correcoes: [] };

  const ids = Array.from(
    new Set(lotes.map((l) => Number(l.id)).filter((id) => Number.isInteger(id) && id > 0))
  );
  let gravados: LoteGravadoParaConferir[] = [];
  if (ids.length > 0) {
    const { data, error } = await client
      .from("pedidos_modelos")
      .select("id, quantidade, numeracao_inicio, gabarito_operacional")
      .in("id", ids);
    if (error) {
      return { ok: false, mensagem: "Não foi possível conferir o Nº final dos lotes (leitura dos lotes gravados). Nada foi gravado.", recusas: [] };
    }
    gravados = (data ?? []) as LoteGravadoParaConferir[];
  }

  // Nenhuma linha nova ou tocada, e nenhuma com faixa a corrigir: o cadastro
  // nem é lido.
  const porId = new Map(gravados.map((g) => [Number(g.id), g]));
  const temTocada = lotes.some((l) => loteFoiTocado(l, l.id ? porId.get(Number(l.id)) : null));
  const temFaixa = lotes.some((l) => l.numeracao_inicio != null && l.numeracao_fim != null && String(l.gabarito_operacional ?? "").trim() !== "");
  if (!temTocada && !temFaixa) return { ok: true, correcoes: [] };

  // Cadastro inteiro, sem o filtro de cliente da tela: o numerador gravado num
  // lote pode ser exclusivo do cliente, e aqui só importa o multiplicador.
  const { data: numeracoes, error: erroNumeracoes } = await client
    .from("producao_numeracoes")
    .select("name, tipo, ticket_qtd");
  if (erroNumeracoes || !numeracoes) {
    return { ok: false, mensagem: "Não foi possível conferir o Nº final dos lotes (leitura do cadastro de numerações). Nada foi gravado.", recusas: [] };
  }

  const recusas = conferirFimDosLotes(lotes, gravados, numeracoes as NumeracaoOpcao[]);
  if (recusas.length > 0) return { ok: false, mensagem: mensagemDaRecusaDoFim(recusas), recusas };
  return { ok: true, correcoes: correcoesDoFimIntocado(lotes, gravados, numeracoes as NumeracaoOpcao[]) };
}
