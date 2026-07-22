/**
 * maestro-save-revalidacao.server.ts
 *
 * Revalidação server-side da cotação pendente ANTES de salvar como proposta.
 *
 * Motivação de segurança:
 *   O `pendingSaveQuotation` viaja dentro do contexto serializado que faz
 *   ida-e-volta pelo browser a cada turno. Um cliente autenticado poderia
 *   adulterar `valorUnitario`, `valorFixo`, quantidades ou o frete antes de
 *   confirmar o save. Este módulo reconfirma TODOS os valores contra as
 *   fontes oficiais (public.produtos, public.clientes, public.clientes_precos_fixos,
 *   public.enderecos) no momento do save.
 *
 * Política em divergência:
 *   REJEITAR — nunca corrigir silenciosamente. O usuário confirmou um total X;
 *   salvar um valor diferente violaria a confirmação explícita exigida pela
 *   governança do Maestro (MAESTRO-SEGURANCA-E-GOVERNANCA.md, seção 8).
 *
 * Regras aplicadas:
 *   - cliente precisa existir e estar acessível via RLS (e ativo);
 *   - todo item precisa existir em public.produtos, estar ativo e ter preço;
 *   - valorUnitario deve bater com "valorUnt" oficial (ou preço fixo do cliente);
 *   - valorFixo deve bater com "valorFixo" oficial (ou 0 quando preço fixo);
 *   - quantidades: inteiras, > 0 e dentro de limite sanitário;
 *   - endereço informado precisa pertencer ao cliente;
 *   - frete: valor finito >= 0; "Retira no balcão" obrigatoriamente R$ 0,00.
 *
 * ⚠️ Somente leitura. Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingSaveQuotation } from './maestro-v2-context-manager';

// Tolerância de comparação monetária (centavos de arredondamento)
const TOLERANCIA = 0.01;
// Limite sanitário de quantidade por item
const QUANTIDADE_MAXIMA = 1_000_000;
// Limite sanitário de valor de frete
const FRETE_MAXIMO = 100_000;

export interface RevalidacaoResult {
  ok: boolean;
  /** Mensagem amigável para o usuário quando ok=false */
  mensagem?: string;
  /** Detalhes técnicos por item (para log/auditoria — não exibir ao usuário) */
  divergencias: string[];
}

/** Linha mínima de public.produtos usada na revalidação */
export interface ProdutoOficial {
  id_produto: number;
  descricao: string | null;
  valorUnt: number | null;
  valorFixo: number | null;
  ativo: boolean;
}

/** Item da cotação pendente (shape usado no PendingSaveQuotation) */
export interface ItemPendente {
  id_produto: number;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  valorFixo: number;
}

/**
 * Núcleo PURO da comparação item a item — sem I/O, testável isoladamente.
 */
export function avaliarItensContraCatalogo(
  itens: ItemPendente[],
  produtosOficiais: ProdutoOficial[],
  precosFixos: Array<{ id_produto: number; preco_fixo: number }>,
  usaPrecoFixo: boolean
): { ok: boolean; divergencias: string[] } {
  const divergencias: string[] = [];

  if (!itens || itens.length === 0) {
    return { ok: false, divergencias: ['Cotação sem itens.'] };
  }

  const mapaProdutos = new Map<number, ProdutoOficial>();
  for (const p of produtosOficiais) mapaProdutos.set(Number(p.id_produto), p);

  const mapaPrecoFixo = new Map<number, number>();
  if (usaPrecoFixo) {
    for (const pf of precosFixos) mapaPrecoFixo.set(Number(pf.id_produto), Number(pf.preco_fixo));
  }

  for (const item of itens) {
    const idProduto = Number(item.id_produto);

    // Sanidade de quantidade
    if (
      !Number.isFinite(item.quantidade) ||
      item.quantidade <= 0 ||
      item.quantidade > QUANTIDADE_MAXIMA ||
      !Number.isInteger(item.quantidade)
    ) {
      divergencias.push(`Item ${idProduto}: quantidade inválida (${item.quantidade}).`);
      continue;
    }

    // Sanidade de valores
    if (!Number.isFinite(item.valorUnitario) || item.valorUnitario < 0) {
      divergencias.push(`Item ${idProduto}: valorUnitario inválido (${item.valorUnitario}).`);
      continue;
    }
    if (!Number.isFinite(item.valorFixo) || item.valorFixo < 0) {
      divergencias.push(`Item ${idProduto}: valorFixo inválido (${item.valorFixo}).`);
      continue;
    }

    const produto = mapaProdutos.get(idProduto);
    if (!produto) {
      divergencias.push(`Item ${idProduto}: produto não encontrado no catálogo oficial.`);
      continue;
    }
    if (!produto.ativo) {
      divergencias.push(`Item ${idProduto} (${produto.descricao ?? ''}): produto inativo.`);
      continue;
    }
    if (produto.valorUnt == null) {
      divergencias.push(`Item ${idProduto} (${produto.descricao ?? ''}): produto sem preço cadastrado.`);
      continue;
    }

    // Preço esperado: preço fixo do cliente (quando houver) ou preço oficial
    const precoFixoCliente = mapaPrecoFixo.get(idProduto);
    const esperadoUnitario = precoFixoCliente != null ? precoFixoCliente : Number(produto.valorUnt);
    const esperadoFixo = precoFixoCliente != null ? 0 : Number(produto.valorFixo ?? 0);

    if (Math.abs(item.valorUnitario - esperadoUnitario) > TOLERANCIA) {
      divergencias.push(
        `Item ${idProduto} (${produto.descricao ?? ''}): valorUnitario divergente ` +
        `(cotação: ${item.valorUnitario} | oficial: ${esperadoUnitario}).`
      );
    }
    if (Math.abs(item.valorFixo - esperadoFixo) > TOLERANCIA) {
      divergencias.push(
        `Item ${idProduto} (${produto.descricao ?? ''}): valorFixo divergente ` +
        `(cotação: ${item.valorFixo} | oficial: ${esperadoFixo}).`
      );
    }
  }

  return { ok: divergencias.length === 0, divergencias };
}

/**
 * Núcleo PURO da validação de frete — sem I/O.
 */
export function avaliarFrete(frete: PendingSaveQuotation['freteEscolhido']): { ok: boolean; divergencias: string[] } {
  const divergencias: string[] = [];

  if (!frete) {
    return { ok: false, divergencias: ['Cotação sem frete escolhido.'] };
  }
  if (!Number.isFinite(frete.valor) || frete.valor < 0 || frete.valor > FRETE_MAXIMO) {
    divergencias.push(`Frete com valor inválido (${frete.valor}).`);
  }
  const ehRetiraBalcao =
    frete.id === 'retira_balcao' ||
    (frete.transportadora ?? '').toLowerCase().includes('retira no balc');
  if (ehRetiraBalcao && Math.abs(frete.valor) > TOLERANCIA) {
    divergencias.push(`"Retira no balcão" deve ter frete R$ 0,00 (recebido: ${frete.valor}).`);
  }

  return { ok: divergencias.length === 0, divergencias };
}

/**
 * Revalida a cotação pendente contra as fontes oficiais no momento do save.
 * Consulta cliente, preços fixos, produtos e endereço com o client autenticado (RLS).
 */
export async function revalidarPendingQuotation(
  supabase: SupabaseClient,
  pending: PendingSaveQuotation
): Promise<RevalidacaoResult> {
  const divergencias: string[] = [];

  const MSG_DIVERGENCIA =
    'Os valores da cotação não conferem com o catálogo oficial atual. ' +
    'Por segurança, não vou salvar. Refaça a cotação para obter os valores vigentes.';

  // ── 1. Cliente precisa existir e estar acessível (RLS) ────────────────────
  const { data: clienteRow, error: clienteErr } = await supabase
    .from('clientes')
    .select('id_cliente, ativo, usa_preco_fixo')
    .eq('id_cliente', pending.clientInternalId)
    .maybeSingle();

  if (clienteErr || !clienteRow) {
    return {
      ok: false,
      mensagem: 'Não consegui confirmar o cliente desta cotação no cadastro. Refaça a cotação identificando o cliente.',
      divergencias: [`Cliente ${pending.clientInternalId} não encontrado/acessível: ${clienteErr?.message ?? 'sem linha'}`],
    };
  }
  if (clienteRow.ativo === false) {
    return {
      ok: false,
      mensagem: 'Este cliente está inativo no cadastro. Reative o cadastro (ou confirme com o responsável) antes de salvar a proposta.',
      divergencias: [`Cliente ${pending.clientInternalId} inativo.`],
    };
  }

  const usaPrecoFixo = clienteRow.usa_preco_fixo === true;

  // ── 2. Preços fixos do cliente (quando aplicável) ─────────────────────────
  let precosFixos: Array<{ id_produto: number; preco_fixo: number }> = [];
  if (usaPrecoFixo) {
    const { data: pfData } = await supabase
      .from('clientes_precos_fixos')
      .select('id_produto, preco_fixo')
      .eq('id_cliente', pending.clientInternalId);
    precosFixos = (pfData ?? []).map(p => ({
      id_produto: Number(p.id_produto),
      preco_fixo: Number(p.preco_fixo),
    }));
  }

  // ── 3. Produtos oficiais dos itens da cotação ─────────────────────────────
  const ids = Array.from(new Set((pending.itens ?? []).map(i => Number(i.id_produto)).filter(n => Number.isFinite(n))));
  let produtosOficiais: ProdutoOficial[] = [];
  if (ids.length > 0) {
    const { data: prodData, error: prodErr } = await supabase
      .from('produtos')
      .select('id_produto, descricao, "valorUnt", "valorFixo", ativo')
      .in('id_produto', ids);
    if (prodErr) {
      return {
        ok: false,
        mensagem: 'Não consegui confirmar os preços oficiais dos produtos agora. Tente novamente em instantes.',
        divergencias: [`Erro ao consultar produtos: ${prodErr.message}`],
      };
    }
    produtosOficiais = (prodData ?? []) as unknown as ProdutoOficial[];
  }

  const resItens = avaliarItensContraCatalogo(
    (pending.itens ?? []) as ItemPendente[],
    produtosOficiais,
    precosFixos,
    usaPrecoFixo
  );
  divergencias.push(...resItens.divergencias);

  // ── 4. Endereço precisa pertencer ao cliente ──────────────────────────────
  if (pending.enderecoId && String(pending.enderecoId).trim() !== '') {
    const { data: endRow } = await supabase
      .from('enderecos')
      .select('id, id_cliente')
      .eq('id', pending.enderecoId)
      .maybeSingle();
    if (!endRow) {
      divergencias.push(`Endereço ${pending.enderecoId} não encontrado.`);
    } else if (Number(endRow.id_cliente) !== Number(pending.clientInternalId)) {
      divergencias.push(
        `Endereço ${pending.enderecoId} pertence ao cliente ${endRow.id_cliente}, não ao cliente ${pending.clientInternalId}.`
      );
    }
  }

  // ── 5. Frete ──────────────────────────────────────────────────────────────
  const resFrete = avaliarFrete(pending.freteEscolhido);
  divergencias.push(...resFrete.divergencias);

  if (divergencias.length > 0) {
    console.warn('[MaestroSaveRevalidacao] Save REJEITADO por divergência:', divergencias);
    return { ok: false, mensagem: MSG_DIVERGENCIA, divergencias };
  }

  return { ok: true, divergencias: [] };
}
