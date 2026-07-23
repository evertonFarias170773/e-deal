/**
 * maestro-save-proposta.server.ts
 *
 * Serviço de salvamento do Maestro — Fase 3a.
 *
 * Responsabilidade:
 *   Receber uma PendingSaveQuotation já montada (com cliente, endereço,
 *   itens resolvidos, frete escolhido, subtotal e total) e persistir como
 *   proposta real no ERP via saveProposta com client autenticado injetado.
 *
 * Regras obrigatórias:
 *   - Nunca salva automaticamente — só executa quando explicitamente chamado.
 *   - Usa o Supabase client autenticado com JWT do usuário logado (RLS funciona).
 *   - Não usa service_role.
 *   - Status sempre "NOVO".
 *   - Se contatoId não existir → bloqueia e retorna mensagem clara.
 *   - Busca vendedor (nome_usuario) pela tabela usuarios via user.id.
 *   - Empresa fixa "Ideal Grafica" (padrão da ERP).
 *
 * ⚠️ Roda apenas no servidor (via API route).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingSaveQuotation } from './maestro-v2-context-manager';
import { saveProposta } from '@/features/orcamentos/services/orcamentos.service';
import type { PropostaFormState, PropostaItem, PropostaFrete } from '@/features/orcamentos/types';
import { revalidarPendingQuotation } from './maestro-save-revalidacao.server';
import { registrarAcaoMaestro } from './maestro-audit.server';

export interface MaestroSaveResult {
  success: boolean;
  idInt?: number;
  errorMessage?: string;
  bloqueadoPorContato?: boolean;
}

/**
 * Persiste uma cotação pendente como proposta real no ERP.
 *
 * @param pending  - Cotação a salvar (montada no contexto V2)
 * @param supabase - Client Supabase autenticado com JWT do usuário logado
 * @param userId   - UUID do usuário logado (auth.uid())
 */
export async function salvarCotacaoComoPropostaReal(
  pending: PendingSaveQuotation,
  supabase: SupabaseClient,
  userId: string
): Promise<MaestroSaveResult> {
  // ── 0. REVALIDAÇÃO SERVER-SIDE ───────────────────────────────────────────
  // O pending viaja pelo browser e é adulterável. Nunca confiar nos valores
  // recebidos: preços, cliente, endereço e frete são reconfirmados contra as
  // fontes oficiais. Divergência → REJEITAR (nunca corrigir silenciosamente).
  const revalidacao = await revalidarPendingQuotation(supabase, pending);
  if (!revalidacao.ok) {
    await registrarAcaoMaestro(supabase, {
      userId,
      acao: 'salvar_cotacao_como_proposta',
      resultado: 'rejeitado',
      idCliente: pending.clientInternalId,
      detalhe: revalidacao.divergencias.slice(0, 5).join(' | '),
      payload: {
        itens: pending.itens?.map(i => ({ id_produto: i.id_produto, qtd: i.quantidade, vu: i.valorUnitario, vf: i.valorFixo })),
        frete: pending.freteEscolhido ? { id: pending.freteEscolhido.id, valor: pending.freteEscolhido.valor } : null,
      },
    });
    return {
      success: false,
      errorMessage: revalidacao.mensagem || 'Não foi possível validar a cotação para salvamento.',
    };
  }

  // ── 1. Resolver contato do cliente ───────────────────────────────────────
  let contatoId = pending.contatoId || '';

  if (!contatoId) {
    // Tenta buscar o primeiro contato disponível
    try {
      const { data: contatos } = await supabase
        .from('contatos')
        .select('id')
        .eq('id_cliente', pending.clientInternalId)
        .limit(1);

      if (contatos && contatos.length > 0) {
        contatoId = String(contatos[0].id);
      }
    } catch (err) {
      console.error('[MaestroSave] Erro ao buscar contato do cliente:', err);
    }

    if (!contatoId) {
      return {
        success: false,
        bloqueadoPorContato: true,
        errorMessage:
          'Não consegui salvar porque o cliente não possui contato cadastrado. ' +
          'Abra o cadastro do cliente, adicione um contato e tente novamente.',
      };
    }
  }

  // ── 2. Resolver vendedor (nome_usuario) pelo user.id ─────────────────────
  let vendedor = 'Vendedor';
  try {
    const { data: usuarioRow } = await supabase
      .from('usuarios')
      .select('nome_usuario')
      .eq('user_id', userId)
      .maybeSingle();

    if (usuarioRow?.nome_usuario) {
      vendedor = usuarioRow.nome_usuario;
    }
  } catch (err) {
    console.warn('[MaestroSave] Não conseguiu resolver nome_usuario, usando fallback:', err);
  }

  // ── 2b. Resolver bônus (percentual_bunus) do cliente ──────────────────────
  // Cliente com preço fixo NÃO acumula bônus (mesma semântica do adapter oficial
  // em maestro-simple-clientes.server.ts, que zera isBonus quando usa_preco_fixo).
  let percentualBonus = 0;
  try {
    const { data: clienteRow } = await supabase
      .from('clientes')
      .select('percentual_bunus, is_bonus, usa_preco_fixo')
      .eq('id_cliente', pending.clientInternalId)
      .maybeSingle();

    if (!clienteRow?.usa_preco_fixo && clienteRow?.is_bonus && clienteRow.percentual_bunus) {
      percentualBonus = Number(clienteRow.percentual_bunus) || 0;
    }
  } catch (err) {
    console.warn('[MaestroSave] Erro ao buscar bônus do cliente:', err);
  }

  // ── 3. Montar PropostaItem[] a partir dos itens resolvidos ────────────────
  const itens: PropostaItem[] = pending.itens.map((item, idx) => {
    const subtotal = item.valorUnitario * item.quantidade + item.valorFixo;
    return {
      id: `maestro_item_${idx + 1}`,
      id_produto: item.id_produto,
      produto: {
        id_produto: item.id_produto,
        descricao: item.nome,
        peso: item.pesoUnitario ?? 0,
        ncm: null,
        cfop_interno: null,
      } as any,
      nome: item.nome,
      nome_produto: item.nome,
      formato: '',
      descricaoModelo: '',
      quantidade: item.quantidade,
      qtd: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorFixo: item.valorFixo,
      subtotalBruto: subtotal,
      acrescimoBonus: 0,
      subtotal,
      prazo: '',
      pesoUnitario: item.pesoUnitario ?? 0,
      pesoTotal: (item.pesoUnitario ?? 0) * item.quantidade,
      variacoesEscolhidas: [],
    };
  });

  // ── 4. Montar PropostaFrete[] ─────────────────────────────────────────────
  const fretes: PropostaFrete[] = [
    {
      id: pending.freteEscolhido.id,
      id_int: 0, // Preenchido após criação da proposta
      transportadora: pending.freteEscolhido.transportadora,
      servico: pending.freteEscolhido.servico,
      valor: pending.freteEscolhido.valor,
      prazo: pending.freteEscolhido.prazo,
      observacao: '',
      escolhido: true,
      pesoUsado: pending.freteEscolhido.pesoUsado,
      id_cotacao: pending.freteEscolhido.id_cotacao,
    },
  ];

  // ── 5. Montar PropostaFormState ───────────────────────────────────────────
  const formState: PropostaFormState = {
    id_int: 'NOVO',
    status: 'NOVO',
    empresa: 'Ideal Grafica',
    vendedor,
    clienteId: String(pending.clientInternalId),
    contatoId,
    enderecoId: pending.enderecoId,
    compradorId: String(pending.clientInternalId), // padrão: mesmo cliente
    itens,
    deletedProdutoPropostaIds: [],
    pedidosModelos: [],
    fretes,
    freteEscolhidoId: pending.freteEscolhido.id,
    descontoGeralTipo: 'PERCENTUAL',
    descontoGeralValor: percentualBonus > 0 ? String(percentualBonus) : '0',
    formaPagamento: 'A definir',
    observacoes: 'Orçamento gerado via Maestro.',
    isAvulso: false,
    clienteNaoCadastrado: false,
  };

  // ── 6. Chamar saveProposta com client autenticado injetado ────────────────
  console.log('[MaestroSave] Iniciando saveProposta para cliente:', pending.clientInternalId, 'vendedor:', vendedor);

  const result = await saveProposta(formState, supabase, userId);

  if (!result.success) {
    console.error('[MaestroSave] saveProposta falhou:', result.errorMessage);
    await registrarAcaoMaestro(supabase, {
      userId,
      acao: 'salvar_cotacao_como_proposta',
      resultado: 'erro',
      idCliente: pending.clientInternalId,
      detalhe: result.errorMessage || 'Erro desconhecido no saveProposta.',
    });
    return {
      success: false,
      errorMessage: result.errorMessage || 'Erro desconhecido ao salvar a proposta.',
    };
  }

  console.log('[MaestroSave] Proposta salva com sucesso. id_int:', result.id_int);

  await registrarAcaoMaestro(supabase, {
    userId,
    acao: 'salvar_cotacao_como_proposta',
    resultado: 'sucesso',
    idCliente: pending.clientInternalId,
    idInt: result.id_int,
    payload: {
      itens: pending.itens?.map(i => ({ id_produto: i.id_produto, qtd: i.quantidade, vu: i.valorUnitario, vf: i.valorFixo })),
      frete: { id: pending.freteEscolhido.id, transportadora: pending.freteEscolhido.transportadora, valor: pending.freteEscolhido.valor },
      total_exibido: pending.total,
    },
  });

  return {
    success: true,
    idInt: result.id_int,
  };
}
