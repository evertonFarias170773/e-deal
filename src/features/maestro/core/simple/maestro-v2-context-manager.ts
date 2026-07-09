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

export interface PendingAmbiguousOption {
  id: number;
  name: string;
  index: number;
}

export interface PendingAmbiguousItem {
  lastRequestedQuantity: number;
  lastRequestedTerm: string;
  options: PendingAmbiguousOption[];
}

export interface MaestroEndereco {
  id: string;
  id_cliente: number;
  tipo_endereco: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface PendingAddressChoice {
  clientId: number;
  addresses: MaestroEndereco[];
}

/** Cotação completa aguardando confirmação explícita do usuário para ser salva */
export interface PendingSaveQuotation {
  /** ID interno do cliente (PK inteira) */
  clientInternalId: number;
  /** Nome do cliente */
  clientName: string;
  /** ID do endereço selecionado (string UUID) */
  enderecoId: string;
  /** CEP do endereço */
  cep: string;
  /** Cidade */
  cidade: string;
  /** UF */
  uf: string;
  /** Endereço completo formatado */
  enderecoFull: string;
  /** ID do contato (preenchido em momento de save ou deixado vazio para buscar) */
  contatoId?: string;
  /** Itens resolvidos com id_produto, preço e peso */
  itens: Array<{
    id_produto: number;
    nome: string;
    quantidade: number;
    valorUnitario: number;
    valorFixo: number;
    subtotal: number;
    pesoUnitario: number;
  }>;
  /** Frete escolhido para salvar */
  freteEscolhido: {
    id: string;
    servico: string;
    transportadora: string;
    valor: number;
    prazo: string;
    pesoUsado: number;
    id_cotacao?: number;
  };
  /** Opções de frete retornadas (para consulta posterior) */
  fretes?: any[];
  /** Subtotal dos produtos */
  subtotal: number;
  /** Total geral (produtos + frete) */
  total: number;
  /** Peso total em gramas (com margem de 2%) */
  pesoTotalGramas: number;
  /** Timestamp de criação da cotação */
  timestamp: string;
  /** Preenchido após save bem-sucedido — impede duplicação */
  savedIdInt?: number;
  /** Timestamp do save */
  savedAt?: string;
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
    clientSearchName?: string;
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
  budgetAddressId?: string;
  budgetAddressFull?: string;
  budgetAddressCep?: string;
  budgetAddressCidade?: string;
  budgetAddressUf?: string;
  pendingAddressChoice?: PendingAddressChoice | null;
  /** Cotação completa aguardando confirmação do usuário para salvar */
  pendingSaveQuotation?: PendingSaveQuotation | null;
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
    lastSuccessfulBudgetItems: [],
    budgetAddressId: undefined,
    budgetAddressFull: undefined,
    pendingAddressChoice: null,
    pendingSaveQuotation: null,
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

  // ── 0. INTERCEPTAÇÃO DE CONFIRMAÇÃO DE SAVE (PRIORIDADE MÁXIMA)
  if (v2Ctx.pendingSaveQuotation && !v2Ctx.pendingSaveQuotation.savedIdInt) {
    const isSalvar = /\b(salvar?\s+cota[cç]a[oã]|salva(r)?|confirmar?\s+save|sim[,.]?\s*(salva|quero\s+salvar?))\b/i.test(clean)
      || /^(salvar?\s+cota[cç]a[oã]|salva(r)?|quero\s+salvar?|confirmar?)$/i.test(clean);
    const isCancelar = /\b(cancela(r)?|não\s+salva(r)?|não\s+quero|descarta(r)?|abort(a|ar)?)\b/i.test(clean)
      || /^(cancela(r)?|não|nao)$/i.test(clean);
    const isEditarAntes = /\b(editar?\s+antes|quero\s+editar?|edita(r)?\s+primeiro|ajustar?\s+antes)\b/i.test(clean)
      || /^(editar?\s+antes|edita(r)?)$/i.test(clean);

    if (isSalvar) {
      console.log('[MaestroV2Context] Confirmação de save detectada.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'salvar_cotacao_confirmada', params: {} }] }
      };
    }
    if (isCancelar) {
      console.log('[MaestroV2Context] Cancelamento de save detectado.');
      v2Ctx.pendingSaveQuotation = null;
      return {
        routed: true,
        plan: { steps: [{ tool: 'cancelar_save_cotacao', params: {} }] }
      };
    }
    if (isEditarAntes) {
      console.log('[MaestroV2Context] Editar antes detectado.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'editar_antes_save', params: {} }] }
      };
    }
  }

  // Proposta já salva — retorna link sem duplicar
  if (v2Ctx.pendingSaveQuotation?.savedIdInt) {
    const isSalvarDuplicado = /\b(salvar?\s+cota[cç]a[oã]|salva(r)?)\b/i.test(clean);
    if (isSalvarDuplicado) {
      return {
        routed: true,
        plan: { steps: [{ tool: 'proposta_ja_salva', params: {} }] }
      };
    }

    // Intercepta perguntas de frete pós-save
    const isConsultaFrete = /\b(qual.*frete|tem.*sedex|quais.*op|opcoes.*frete|valor.*frete|frete)\b/i.test(clean);
    if (isConsultaFrete) {
      return {
        routed: true,
        plan: { steps: [{ tool: 'consultar_fretes_cotacao', params: {} }] }
      };
    }
  }

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
  // Aceita: cliente, cli, cadastro, liente, clinte, ciente + id_cliente NNN
  // Aceita: cpf/cnpj + número (parcial ou completo)
  // Aceita: "sobre o cliente", "e o cliente", "e cliente"
  // Aceita: "sobre o <nome-próprio>" (quando não for campo contextual)
  // NÃO aceita: "id 8469" sozinho (sem prefixo explícito de cliente)
  const regexClientePrefixo = /\b(cliente|cli|cadastro|liente|clinte|ciente)\s*([a-z\d]+)/i;
  const regexSobreCliente   = /\b(sobre\s+o\s+cliente|e\s+o\s+cliente|e\s+cliente|no\s+cliente)\s+/i;
  const regexDocPrefixo     = /\b(cpf|cnpj)\s+\d{4,}/i;
  const regexIdCliente      = /\bid[_\s]cliente\s*:?\s*\d+/i;
  const regexCodigo         = /\bc\s*\d+/i;

  // Detecta "sobre o <nome>" quando não for campo contextual
  // Campos que indicam pergunta sobre o cliente ativo (devem passar para P3)
  const CAMPOS_CONTEXTUAIS_SOBRE = [
    'telefone', 'email', 'e-mail', 'endereco', 'enderecos', 'contato', 'contatos',
    'socio', 'socios', 'boleto', 'boletos', 'bonus', 'limite', 'credito',
    'vendedor', 'restricao', 'ativo', 'status', 'cnpj', 'cpf', 'pagamento'
  ];
  const sobreNomeMatch = clean.match(/\bsobre\s+(?:o|a|os|as)?\s*([a-z][a-z\s]{2,40})$/i);
  const sobreEhBuscaCliente = sobreNomeMatch &&
    !CAMPOS_CONTEXTUAIS_SOBRE.some(c => (sobreNomeMatch[1] ?? '').toLowerCase().includes(c));

  if (
    regexClientePrefixo.test(clean) ||
    regexSobreCliente.test(clean) ||
    regexDocPrefixo.test(clean) ||
    regexIdCliente.test(clean) ||
    regexCodigo.test(clean) ||
    sobreEhBuscaCliente
  ) {
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

  // ── 3.0 RETOMADA EXPLÍCITA DE ORÇAMENTO (SOBREPÕE FINANCEIRO)
  const hasOrcamentoKeyword = /\b(do\s*orcamento|no\s*orcamento|nesse\s*orcamento|desse\s*orcamento|do\s*pedido\s*avulso|refazer\s*(o\s*)?orcamento|recalcular\s*(o\s*)?orcamento|qual\s*(e\s*)?(o\s*)?total|total\s*agora)\b/i.test(clean)
    || /\b(remove|tira(r)?|retira|sem\s+a(s)?|sem\s+o(s)?|refaz\s+sem|mantem|mantém|volta\s+o|volta\s+a|coloca\s+de\s+volta|nao\s+tira|nao\s+remove|preserva|restaura)\b.+/i.test(clean);
  const hasItemsToRecover = (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0)
    || (v2Ctx.lastSuccessfulBudgetItems && v2Ctx.lastSuccessfulBudgetItems.length > 0)
    || (v2Ctx.previousOrcamentoItens && v2Ctx.previousOrcamentoItens.length > 0);

  if (hasOrcamentoKeyword && hasItemsToRecover && v2Ctx.domain !== 'orcamento_avulso') {
    console.log(`[MaestroV2Context] Retomada explícita de orçamento detectada. Restaurando domínio para orcamento_avulso.`);
    v2Ctx.domain = 'orcamento_avulso';
    if (!v2Ctx.orcamentoItens || v2Ctx.orcamentoItens.length === 0) {
       v2Ctx.orcamentoItens = v2Ctx.lastSuccessfulBudgetItems || v2Ctx.previousOrcamentoItens || [];
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

