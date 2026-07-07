import type { AllowedToolName } from './maestro-v2-router';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';

export type MaestroV2Domain = 'cliente' | 'financeiro' | 'orcamento_avulso' | 'proposta' | 'boleto' | 'desconhecido';

export interface OrcamentoAvulsoItem {
  quantidade: number;
  termo: string;
}

export interface PendingProductResolution {
  lastRequestedQuantity: number;
  lastRequestedTerm: string;
  status: 'nao_encontrado' | 'preco_incompleto';
}

export interface PendingAmbiguousItem {
  lastRequestedQuantity: number;
  lastRequestedTerm: string;
  options: string[];
}

export interface MaestroV2Context {
  version: number;
  updatedAt: string;
  domain: MaestroV2Domain;
  lastTool?: AllowedToolName;
  activeEntities: {
    clientId?: string;
    clientInternalId?: number;
    clientName?: string;
    proposalId?: string;
    activeIdInt?: number;
  };
  pendingActions: string[];
  lastStructuredAnswer?: any;
  orcamentoItens?: OrcamentoAvulsoItem[];
  pendingProductResolution?: PendingProductResolution | null;
  pendingAmbiguousItem?: PendingAmbiguousItem | null;
  previousOrcamentoItens?: OrcamentoAvulsoItem[];
  lastRequestedQuantity?: number;
  lastExplicitBudgetRequestText?: string;
  lastExplicitBudgetItems?: OrcamentoAvulsoItem[];
  lastSuccessfulBudgetItems?: OrcamentoAvulsoItem[];
}

const CONTEXT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutos de validade

export function getEmptyV2Context(): MaestroV2Context {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    domain: 'desconhecido',
    activeEntities: {},
    pendingActions: [],
    orcamentoItens: [],
    pendingProductResolution: null,
    pendingAmbiguousItem: null,
    previousOrcamentoItens: [],
    lastRequestedQuantity: undefined,
    lastExplicitBudgetRequestText: undefined,
    lastExplicitBudgetItems: [],
    lastSuccessfulBudgetItems: []
  };
}

export function limparItensInvalidosContexto(v2Ctx: MaestroV2Context): void {
  if (v2Ctx.orcamentoItens) {
    v2Ctx.orcamentoItens = v2Ctx.orcamentoItens.filter(item => {
      const cleanTerm = item.termo.trim().toLowerCase();
      if (!cleanTerm) return false;
      const blacklistedTerms = /\b(boa\s*tarde|bom\s*dia|boa\s*noite|jesus|doido|bagunca|errado|nao|sim|ok|quero|remova|muda|altera|troca|agora|proposta|doida|doideira|que\s*isso|vc|ficou|quis\s*dizer|refaca|recalcula|faz\s*de\s*novo)\b/i;
      if (blacklistedTerms.test(cleanTerm)) return false;
      if (cleanTerm.split(/\s+/).length > 20) return false;
      return true;
    });
  }
}

export function deserializeV2Context(json?: string | null): MaestroV2Context {
  if (!json) return getEmptyV2Context();
  try {
    const ctx = JSON.parse(json) as MaestroV2Context;
    
    const age = Date.now() - new Date(ctx.updatedAt).getTime();
    if (age > CONTEXT_MAX_AGE_MS) {
      console.log(`[MaestroV2Context] Contexto expirado (idade: ${Math.round(age / 1000)}s). Limpando.`);
      return getEmptyV2Context();
    }
    
    limparItensInvalidosContexto(ctx);
    
    return ctx;
  } catch (err) {
    console.warn('[MaestroV2Context] Falha ao deserializar contexto V2. Resetando.', err);
    return getEmptyV2Context();
  }
}

export function serializeV2Context(ctx: MaestroV2Context): string {
  limparItensInvalidosContexto(ctx);
  ctx.updatedAt = new Date().toISOString();
  return JSON.stringify(ctx);
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Tenta processar de forma determinística caso seja uma continuação do contexto ativo.
 * Retorna um plano/resultado do roteador ou null se deve seguir o fluxo normal.
 */

export function handleContextContinuation(
  query: string,
  v2Ctx: MaestroV2Context,
  activeClient: any
): { routed: boolean; plan: any } | null {
  const clean = normalizeText(query);

  // ── 1. CANCELAMENTO DO ORÇAMENTO AVULSO (PRIORIDADE CRÍTICA)
  const isCancelOrcamento = /\b(nao\s*(quero|e)\s*orca(r|mento)|esquece\s*orca(r|mento))\b/i.test(clean);
  if (isCancelOrcamento) {
    console.log('[MaestroV2Context] Ação: Cancelamento de orçamento avulso solicitado.');
    v2Ctx.orcamentoItens = [];
    v2Ctx.pendingProductResolution = null;
    v2Ctx.pendingAmbiguousItem = null;
    v2Ctx.domain = activeClient ? 'cliente' : 'desconhecido';
    return {
      routed: true,
      plan: {
        steps: [
          {
            tool: 'cancelar_orcamento_avulso',
            params: {}
          }
        ]
      }
    };
  }

  // ── 2. COMANDO DE CLIENTE EXPLÍCITO (PRIORIDADE MÁXIMA)
  const regexClient1 = /\b(cliente|cli|cadastro)\s*([a-z\d]+)/i;
  const regexClient2 = /\bc\s*\d+/i;
  if (regexClient1.test(clean) || regexClient2.test(clean)) {
    console.log('[MaestroV2Context] Comando de cliente explícito detectado. Suspendendo orçamento avulso.');
    v2Ctx.domain = 'cliente';
    return null;
  }

  // ── 3. PERGUNTAS CONTEXTUAIS DE CLIENTE ATIVO (PRIORIDADE ALTA)
  if (activeClient) {
    // Verifica se a mensagem contém palavras chave de relacionamento/dados cadastrais
    const hasClientFieldKeyword = /\b(endereco|enderecos|contato|contatos|telefone|whats|whatsapp|email|e-mail|vinculo|vinculos|socio|socios|dele|desse cliente|dessa empresa|onde entrega|entrega)\b/i.test(clean);
    
    if (hasClientFieldKeyword) {
      let campo: string | null = null;
      
      if (/\b(endereco|enderecos|onde entrega|entrega)\b/i.test(clean)) {
        campo = 'enderecos';
      } else if (/\b(contato|contatos)\b/i.test(clean)) {
        campo = 'contatos';
      } else if (/\b(vinculo|vinculos|socio|socios)\b/i.test(clean)) {
        campo = 'socios';
      } else if (/\b(telefone|whats|whatsapp)\b/i.test(clean)) {
        campo = 'telefone';
      } else if (/\b(email|e-mail)\b/i.test(clean)) {
        campo = 'email';
      } else if (/\b(cidade|localizacao)\b/i.test(clean)) {
        campo = 'cidade';
      } else if (/\b(credito|limite)\b/i.test(clean)) {
        campo = 'credito';
      } else if (/\b(vendedor)\b/i.test(clean)) {
        campo = 'vendedor';
      } else if (/\b(restricao)\b/i.test(clean)) {
        campo = 'restricao';
      } else if (/\b(ativo|status)\b/i.test(clean)) {
        campo = 'ativo';
      } else if (/\b(risco)\b/i.test(clean)) {
        campo = 'risco_credito';
      } else if (/\b(nome|razao|social)\b/i.test(clean)) {
        campo = 'nome';
      } else if (/\b(fundacao)\b/i.test(clean)) {
        campo = 'fundacao';
      }

      if (campo) {
        console.log(`[MaestroV2Context] Roteamento determinístico contextual de cliente ativo. Campo: "${campo}", Cliente: ${activeClient.clientName}`);
        v2Ctx.domain = 'cliente';
        
        // Zera pendências de orçamento avulso, pois mudamos de assunto
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
        
        return {
          routed: true,
          plan: {
            steps: [
              {
                tool: 'consultarCampoCadastro',
                params: {
                  campo,
                  id_cliente: activeClient.clientInternalId
                }
              }
            ]
          }
        };
      }
    }
  }

  
  // ── 3.1 BYPASS TEMPORÁRIO E DELEGAÇÃO AO MOTOR ISOLADO
  if (v2Ctx.domain === 'orcamento_avulso') {
    const isAvulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED === 'true';

    const engineResult = processarOrcamentoAvulso(query, {
      itens: v2Ctx.orcamentoItens || [],
      pendingAmbiguity: !!v2Ctx.pendingProductResolution || !!v2Ctx.pendingAmbiguousItem,
      pendingQuantidade: v2Ctx.pendingProductResolution?.lastRequestedQuantity || v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity,
      pendingTerm: v2Ctx.pendingProductResolution?.lastRequestedTerm || v2Ctx.pendingAmbiguousItem?.lastRequestedTerm,
      // Passa histórico de itens para suportar RESTORE
      previousItens: v2Ctx.previousOrcamentoItens || [],
    });

    if (engineResult.action !== 'NONE') {
      if (!isAvulsoEnabled) {
        v2Ctx.domain = 'desconhecido';
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
        return {
          routed: true,
          plan: {
            steps: [{ tool: 'orcamento_avulso_desativado', params: {} }]
          }
        };
      }

      // Salvar histórico apenas para ações destrutivas (não para RESTORE)
      if (engineResult.action !== 'RESTORE') {
        v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
      }
      v2Ctx.orcamentoItens = engineResult.items;

      if (engineResult.action === 'CLEAR') {
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
        return {
          routed: true,
          plan: { steps: [{ tool: 'limpar_orcamento_avulso', params: {} }] }
        };
      } else {
        if (engineResult.items.length > 0) {
            v2Ctx.lastRequestedQuantity = engineResult.items[engineResult.items.length - 1].quantidade;
            v2Ctx.lastExplicitBudgetItems = engineResult.items;
        }
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
        console.log(`[MaestroV2Context] Ação: ${engineResult.action} → simularOrcamentoAvulso. Itens: ${JSON.stringify(v2Ctx.orcamentoItens)}`);
        return {
          routed: true,
          plan: { steps: [{ tool: 'simularOrcamentoAvulso', params: { itens: v2Ctx.orcamentoItens } }] }
        };
      }
    }
  }

  // 3. DOMÍNIO: FINANCEIRO (Confirmações)
  if (v2Ctx.domain === 'financeiro') {
    const isConfirmation = /\b(tem\s*certeza|confirma|confere|qual\s*a\s*fonte|origem|origem\s*do\s*dado)\b/i.test(clean);
    if (isConfirmation) {
      console.log('[MaestroV2Context] Confirmação financeira detectada. Roteando para revalidarUltimaConsulta.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'revalidarUltimaConsulta',
              params: {}
            }
          ]
        }
      };
    }
  }

  return null;
}

