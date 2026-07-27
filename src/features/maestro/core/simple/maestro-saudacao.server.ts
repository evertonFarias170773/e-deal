/**
 * maestro-saudacao.server.ts
 *
 * Saudação do dia do Maestro Vendedor: no PRIMEIRO acesso do dia ao chat,
 * o vendedor recebe cumprimento + frase curta de incentivo + resumo
 * comercial (faturamento do mês, propostas aguardando retorno do cliente,
 * paradas 2+ dias). Texto 100% DETERMINÍSTICO — nenhuma chamada de LLM,
 * nenhum número fora das fontes oficiais.
 *
 * Regras:
 *   - flag MAESTRO_SAUDACAO_DIA_ENABLED (default OFF);
 *   - somente usuários com usuarios.is_vendedor=true e vínculo comercial;
 *   - 1×/dia: se JÁ existe mensagem do usuário hoje (qualquer conversa,
 *     RLS por user_id) — inclusive a própria saudação persistida — não repete;
 *   - falha parcial → só as seções que vieram; tudo falhou → null (nunca 500);
 *   - metas NÃO aparecem (não existem no ERP — fase 2).
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarNomeUsuario } from './maestro-simple-vendedores.server';
import { calcularPerformanceVendedor } from './maestro-simple-performance.server';
import { listarPipelineVendedor } from './maestro-simple-propostas.server';
import { inicioDiaSaoPauloUtcIso, horaSaoPaulo, ymdSaoPaulo } from './maestro-simple-tempo';

export function isSaudacaoDiaEnabled(): boolean {
  return process.env.MAESTRO_SAUDACAO_DIA_ENABLED === 'true';
}

const FRASES_INCENTIVO = [
  'Vamos buscar mais um excelente dia de vendas.',
  'Cada contato de hoje é uma proposta a caminho.',
  'Dia novo, carteira aquecida — bora vender!',
  'Consistência fecha pedido: um cliente de cada vez.',
  'Hoje é um ótimo dia para transformar orçamento em pedido.',
  'Seu follow-up de hoje é a venda de amanhã.',
  'Foco no cliente certo faz o mês acontecer.',
  'Boas conversas geram boas propostas — vamos lá!',
];

function cumprimentoPorHorario(hora: number): string {
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function brl(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function diaDoAno(ymd: string): number {
  const [ano, mes, dia] = ymd.split('-').map(Number);
  const inicio = Date.UTC(ano, 0, 1);
  return Math.floor((Date.UTC(ano, mes - 1, dia) - inicio) / 86_400_000);
}

/**
 * Monta a saudação do dia, ou null quando não se aplica
 * (flag off, não-vendedor, já houve contato hoje, ou nenhuma fonte respondeu).
 */
export async function montarSaudacaoDoDia(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ content: string } | null> {
  if (!isSaudacaoDiaEnabled()) return null;

  try {
    const eu = await buscarNomeUsuario(supabase, userId);
    if (!eu.isVendedor || !eu.nomeComercial) return null;

    // 1º contato do dia: qualquer mensagem de hoje (RLS limita ao usuário)
    const { data: msgsHoje, error: msgsErr } = await supabase
      .from('maestro_mensagens')
      .select('id')
      .gte('created_at', inicioDiaSaoPauloUtcIso())
      .limit(1);
    if (msgsErr || (msgsHoje ?? []).length > 0) return null;

    // Fontes oficiais — falha em uma não derruba a outra
    const agora = new Date();
    const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
    const desde90d = new Date(agora.getTime() - 90 * 86_400_000).toISOString();

    const [perf, pipeline] = await Promise.all([
      calcularPerformanceVendedor(supabase, {
        vendedorNome: eu.nomeComercial,
        desde: inicioMes,
        periodoLabel: 'mês atual',
      }).catch(() => null),
      listarPipelineVendedor(supabase, eu.nomeComercial, {
        desde: desde90d,
        periodoLabel: 'últimos 90 dias',
        diasParada: 2,
        limite: 1,
      }).catch(() => null),
    ]);

    const bullets: string[] = [];
    if (pipeline && !pipeline.error) {
      const ar = pipeline.aguardando_retorno_cliente;
      bullets.push(
        `${ar.quantidade} proposta(s) aguardando retorno do cliente` +
          (ar.quantidade > 0 ? ` (${brl(ar.soma_valor)})` : '') +
          ' — últimos 90 dias;',
      );
      if (pipeline.paradas.quantidade > 0) {
        bullets.push(
          `${pipeline.paradas.quantidade} delas sem movimentação interna há ${pipeline.paradas.dias_sem_movimento}+ dias;`,
        );
      }
    }
    if (perf && !perf.error) {
      bullets.push(
        perf.atual.pedidos_pagos > 0
          ? `faturamento do mês: ${brl(perf.atual.faturamento)} (${perf.atual.pedidos_pagos} pedido(s) pago(s)).`
          : 'ainda não há faturamento confirmado neste mês.',
      );
    }
    if (bullets.length === 0) return null;

    const ymd = ymdSaoPaulo(agora);
    const primeiroNome = (eu.nome ?? eu.nomeComercial).split(' ')[0];
    const frase = FRASES_INCENTIVO[diaDoAno(ymd) % FRASES_INCENTIVO.length];

    const content =
      `${cumprimentoPorHorario(horaSaoPaulo(agora))}, ${primeiroNome}! ${frase}\n\n` +
      'Hoje você possui:\n' +
      bullets.map(b => `- ${b}`).join('\n') +
      '\n\nQuer que eu detalhe as propostas aguardando retorno ou a sua performance do mês?';

    return { content };
  } catch (err) {
    console.warn('[MaestroSaudacao] Falha ao montar saudação (ignorada):', err);
    return null;
  }
}
