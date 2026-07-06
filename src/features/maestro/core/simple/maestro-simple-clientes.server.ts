/**
 * maestro-simple-clientes.server.ts
 *
 * Busca dados do cliente no ERP.
 * Evoluído para "Cliente Detalhado" (Fase Cliente 100%).
 *
 * Realiza uma busca inicial em vw_cadastros_clientes_lista para resolver o ID principal.
 * Em seguida, busca os detalhes completos nas tabelas:
 * - clientes
 * - enderecos
 * - contatos
 * - clientes_socios
 *
 * ⚠️ Roda apenas no servidor (via API route), preservando RLS com auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SimpleClientContext, EnderecoSimples, ContatoSimples, SocioSimples } from './maestro-simple-context';

export interface MaestroClientLookupResult {
  found: boolean;
  reason?: 'not_found' | 'auth_error' | 'multiple';
  client?: SimpleClientContext | null;
}

function toStr(val: any): string {
  if (val == null) return '';
  return String(val).trim();
}

function toNum(val: any): number | undefined {
  if (val == null || val === '') return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}

// ─── Normalização mínima ─────────────────────────────────────────────────
function normalizeSearchTerm(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[%*,]/g, '');
}

/**
 * Monta o contexto detalhado a partir do id_cliente principal,
 * realizando leituras paralelas (read-only) de todas as relações permitidas.
 */
async function buildDetailedClientContext(
  supabase: SupabaseClient,
  idCliente: number,
  displayCode: string,
  viewData: any
): Promise<SimpleClientContext | null> {
  
  // 1. Busca detalhada do cliente base
  const { data: clientRow, error: clientErr } = await supabase
    .from('clientes')
    .select(`
      id, id_cliente, nome, apelido, fantasia, documento,
      telefone_fixo, whatsapp_1, whatsapp_2,
      email, email_contato, email_financeiro,
      cidade_uf, nome_vendedor,
      credito, limite_credito,
      is_bonus, percentual_bunus,
      data_fundacao, data_cadastro,
      tipo_pessoa, risco_credito, restricao, ativo, obs,
      padrao_pagamento, categoria
    `)
    .eq('id_cliente', idCliente)
    .single();

  if (clientErr || !clientRow) {
    console.error('[MaestroSimpleServer] Erro ou não encontrou detalhes do cliente na tabela física', idCliente, clientErr);
    return null; // Falhou no detalhamento
  }

  // 2. Buscas paralelas nas relações
  const [enderecosResult, contatosResult, sociosResult] = await Promise.all([
    supabase
      .from('enderecos')
      .select('tipo_endereco, cep, endereco, numero, complemento, bairro, cidade, uf, obs')
      .eq('id_cliente', idCliente)
      .limit(20),
    supabase
      .from('contatos')
      .select('nome_contato, cargo, whats, e_mail')
      .eq('id_cliente', idCliente)
      .limit(20),
    supabase
      .from('clientes_socios')
      .select('id_cliente_socio, tipo_relacao')
      .eq('id_cliente_principal', idCliente)
      .limit(20)
  ]);

  const enderecosRaw = enderecosResult.data || [];
  const contatosRaw = contatosResult.data || [];
  const sociosRaw = sociosResult.data || [];

  // 3. Enriquecer nomes dos sócios (leitura adicional)
  let sociosEnriquecidos: SocioSimples[] = sociosRaw.map(s => ({
    idClienteSocio: toNum(s.id_cliente_socio) ?? null,
    tipoRelacao: toStr(s.tipo_relacao) || null,
  }));

  const socioIds = sociosEnriquecidos.map(s => s.idClienteSocio).filter((id): id is number => id !== null);
  if (socioIds.length > 0) {
    const { data: socioNames } = await supabase
      .from('clientes')
      .select('id_cliente, nome, fantasia')
      .in('id_cliente', socioIds);
    
    if (socioNames) {
      sociosEnriquecidos = sociosEnriquecidos.map(s => {
        const found = socioNames.find(sn => sn.id_cliente === s.idClienteSocio);
        return {
          ...s,
          nomeSocio: found ? (found.fantasia || found.nome || `Cliente ${s.idClienteSocio}`) : undefined
        };
      });
    }
  }

  // 4. Mapear para o formato final
  const tel = toStr(clientRow.whatsapp_1) || toStr(clientRow.whatsapp_2) || toStr(clientRow.telefone_fixo);
  const mainEmail = toStr(clientRow.email) || toStr(clientRow.email_contato) || toStr(clientRow.email_financeiro);

  return {
    // Identificação
    clientDisplayCode: displayCode,
    clientInternalId:  idCliente,
    clientName:        toStr(clientRow.nome) || toStr(clientRow.fantasia) || `Cliente ${displayCode}`,
    clientFantasia:    toStr(clientRow.fantasia) || undefined,
    clientDocument:    toStr(clientRow.documento) || undefined,
    tipoPessoa:        toStr(clientRow.tipo_pessoa) || undefined,

    // Contato
    clientPhone:           tel || undefined,
    clientWhatsapp2:       toStr(clientRow.whatsapp_2) || undefined,
    clientEmail:           mainEmail || undefined,
    clientEmailContato:    toStr(clientRow.email_contato) || undefined,
    clientEmailFinanceiro: toStr(clientRow.email_financeiro) || undefined,

    // Localização
    clientCityUf: toStr(clientRow.cidade_uf) || undefined,

    // Comercial
    clientSeller:      toStr(clientRow.nome_vendedor) || undefined,
    clientCredit:      toNum(clientRow.credito),
    clientCreditLimit: toNum(clientRow.limite_credito),
    isBonus:           clientRow.is_bonus ?? undefined,
    percentualBonus:   toNum(clientRow.percentual_bunus),
    riscoCredito:      toStr(clientRow.risco_credito) || undefined,
    restricao:         clientRow.restricao ?? undefined,
    ativo:             clientRow.ativo ?? undefined,
    padraoPagamento:   toStr(clientRow.padrao_pagamento) || undefined,
    categoria:         toStr(clientRow.categoria) || undefined,

    // Datas e Pedidos (vindos da view)
    clientDataFundacao:  toStr(clientRow.data_fundacao) || undefined,
    clientDataCadastro:  toStr(clientRow.data_cadastro) || undefined,
    clientDataUltPedido: toStr(viewData.data_ult_pedido) || undefined,
    clientQtdPedidos:    toNum(viewData.qtd_pedidos),

    // Obs (não exibir por padrão)
    obsInterna: toStr(clientRow.obs) || undefined,

    // Relações
    enderecos: enderecosRaw.map(e => ({
      tipoEndereco: toStr(e.tipo_endereco) || null,
      cep: toStr(e.cep) || null,
      endereco: toStr(e.endereco) || null,
      numero: toStr(e.numero) || null,
      complemento: toStr(e.complemento) || null,
      bairro: toStr(e.bairro) || null,
      cidade: toStr(e.cidade) || null,
      uf: toStr(e.uf) || null,
      obs: toStr(e.obs) || null,
    })),
    contatos: contatosRaw.map(c => ({
      nomeContato: toStr(c.nome_contato) || null,
      cargo: toStr(c.cargo) || null,
      whats: toStr(c.whats) || null,
      email: toStr(c.e_mail) || null,
    })),
    socios: sociosEnriquecidos,

    // Rastreio
    source: 'public.clientes',
    queriedAt: new Date().toISOString(),
    fontesRelacoes: {
      enderecos: 'public.enderecos',
      contatos: 'public.contatos',
      socios: 'public.clientes_socios',
    }
  };
}


// ─── Buscas Principais ────────────────────────────────────────────────────

/**
 * Tenta localizar 1 cliente por ID numérico e depois enriquece os detalhes.
 */
export async function buscarClientePorCodigo(
  supabase: SupabaseClient,
  codigoStr: string
): Promise<MaestroClientLookupResult> {
  if (!codigoStr) return { found: false, reason: 'not_found' };

  try {
    const numCode = parseInt(codigoStr, 10);
    let rows: any[] | null = null;
    let error: any = null;

    if (!isNaN(numCode)) {
      // Prioridade 1: busca exata por ID inteiro no banco
      const res = await supabase
        .from('vw_cadastros_clientes_lista')
        .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
        .eq('id_cliente', numCode)
        .limit(1);
      rows = res.data;
      error = res.error;
    }

    if ((!rows || rows.length === 0) && !error) {
      // Prioridade 2: busca por prefixo de texto do código
      const res = await supabase
        .from('vw_cadastros_clientes_lista')
        .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
        .ilike('id_cliente_text', `${codigoStr}%`)
        .limit(1);
      rows = res.data;
      error = res.error;
    }

    if (error) {
      if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
        return { found: false, reason: 'auth_error' };
      }
      return { found: false, reason: 'not_found' };
    }

    const row = rows?.[0];
    if (!row) return { found: false, reason: 'not_found' };

    // 2. Enriquece
    const detailedClient = await buildDetailedClientContext(supabase, row.id_cliente, row.id_cliente_text, row);
    
    if (!detailedClient) {
      // Fallback: se a view encontrou mas a tabela física falhou
      console.warn('[MaestroSimpleServer] Enriquecimento falhou, retornando dados básicos da view para o cliente', row.id_cliente);
      return {
        found: true,
        client: buildFallbackClientContext(row)
      };
    }

    return { found: true, client: detailedClient };
  } catch (err) {
    console.error('[MaestroSimpleServer] Erro em buscarClientePorCodigo:', err);
    return { found: false, reason: 'not_found' };
  }
}

/**
 * Tenta localizar 1 cliente por texto (CNPJ, nome) usando a view, depois enriquece.
 */
export async function buscarClientePorTexto(
  supabase: SupabaseClient,
  termo: string
): Promise<MaestroClientLookupResult> {
  const t = normalizeSearchTerm(termo);
  if (!t || t.length < 3) return { found: false, reason: 'not_found' };

  try {
    const { data: rows, error } = await supabase
      .from('vw_cadastros_clientes_lista')
      .select('id_cliente, id_cliente_text, nome, fantasia, documento, cidade_uf, ativo, qtd_pedidos, data_ult_pedido')
      .ilike('busca_geral', `%${t}%`)
      .order('id_cliente', { ascending: false })
      .limit(2);

    if (error) {
      if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
        return { found: false, reason: 'auth_error' };
      }
      return { found: false, reason: 'not_found' };
    }

    if (!rows || rows.length === 0) {
      return { found: false, reason: 'not_found' };
    }

    // Se retornar mais de 1, ainda assim pegamos o mais recente.
    // Em implementações futuras podemos tratar múltiplos resultados.
    const row = rows[0];

    // 2. Enriquece
    const detailedClient = await buildDetailedClientContext(supabase, row.id_cliente, row.id_cliente_text, row);
    
    if (!detailedClient) {
      // Fallback
      console.warn('[MaestroSimpleServer] Enriquecimento falhou na busca por texto, retornando dados básicos da view', row.id_cliente);
      return {
        found: true,
        client: buildFallbackClientContext(row)
      };
    }

    return { found: true, client: detailedClient };
  } catch (err) {
    console.error('[MaestroSimpleServer] Erro em buscarClientePorTexto:', err);
    return { found: false, reason: 'not_found' };
  }
}

// ─── Fallback ─────────────────────────────────────────────────────────────

/**
 * Monta um contexto de cliente simplificado, apenas com os dados
 * encontrados na view (útil se a tabela física falhar).
 */
function buildFallbackClientContext(viewRow: any): SimpleClientContext {
  return {
    clientDisplayCode: viewRow.id_cliente_text || String(viewRow.id_cliente),
    clientInternalId:  viewRow.id_cliente,
    clientName:        viewRow.fantasia || viewRow.nome || `Cliente ${viewRow.id_cliente}`,
    clientFantasia:    viewRow.fantasia || undefined,
    clientDocument:    viewRow.documento || undefined,
    ativo:             viewRow.ativo ?? undefined,
    clientDataUltPedido: String(viewRow.data_ult_pedido) || undefined,
    clientQtdPedidos:  Number(viewRow.qtd_pedidos) || undefined,
    clientCityUf:      viewRow.cidade_uf || undefined,
    
    // Fallback vazio obrigatório pelas constraints
    enderecos: [],
    contatos: [],
    socios: [],
    
    source: 'vw_cadastros_clientes_lista',
    queriedAt: new Date().toISOString(),
    fontesRelacoes: {
      enderecos: 'fallback (view)',
      contatos: 'fallback (view)',
      socios: 'fallback (view)'
    }
  };
}
