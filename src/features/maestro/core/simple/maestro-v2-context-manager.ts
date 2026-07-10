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

// ─── Snapshot de Cotação Ativa (conversável) ─────────────────────────────

/**
 * Snapshot da cotação exibida no chat — usada para responder perguntas
 * sem cair no Brain e para persistir alterações de frete/endereço antes do save.
 */
export interface ActiveQuoteSnapshot {
  /** Timestamp de criação */
  createdAt: string;
  /** Cliente da cotação */
  clientInternalId: number;
  clientName: string;
  /** Itens resolvidos — nome OFICIAL do produto, sem inferência */
  itens: Array<{
    id_produto: number;
    nome: string;
    quantidade: number;
    valorUnitario: number;
    valorFixo: number;
    subtotal: number;
    pesoUnitario: number;
  }>;
  /** Endereço usado */
  enderecoId: string;
  enderecoFull: string;
  cep: string;
  cidade: string;
  uf: string;
  /** Todas as opções de frete retornadas */
  fretes: Array<{
    id: string;
    servico: string;
    transportadora: string;
    valor: number;
    prazo: string;
    pesoUsado: number;
    id_cotacao?: number;
  }>;
  /** Frete atualmente selecionado */
  freteSelecionado: {
    id: string;
    servico: string;
    transportadora: string;
    valor: number;
    prazo: string;
    pesoUsado: number;
    id_cotacao?: number;
  };
  /** Subtotal dos produtos (sem frete e bruto) */
  subtotalProdutos: number;
  /** Percentual de bonus vindo do cadastro (se > 0) */
  percentualBonus?: number;
  /** Desconto real aplicado sobre o subtotalProdutos (em Reais) */
  descontoReais?: number;
  /** Subtotal liquido (produtos bruto - desconto) */
  subtotalLiquido?: number;
  /** Total = (subtotalLiquido ?? subtotalProdutos) + freteSelecionado.valor */
  total: number;
  /** Peso total em gramas (com margem 2%) */
  pesoTotalGramas: number;
  /** nao_salva enquanto não confirmado; salva após save */
  status: 'nao_salva' | 'salva';
  /** Preenchido após save */
  savedIdInt?: number;
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
  /** Subtotal (bruto) dos produtos */
  subtotal: number;
  /** Percentual de bonus vindo do cadastro (se > 0) */
  percentualBonus?: number;
  /** Desconto real aplicado sobre o subtotal (em Reais) */
  descontoReais?: number;
  /** Subtotal liquido (produtos bruto - desconto) */
  subtotalLiquido?: number;
  /** Peso total do pacote em gramas (2% margem) */
  pesoTotalGramas: number;
  /** Total final (subtotalLiquido ?? subtotal) + frete */
  total: number;
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
  /** Snapshot conversável da cotação ativa exibida no chat */
  activeQuote?: ActiveQuoteSnapshot | null;

  // ── Confirmação de cliente pendente ──────────────────────────────────────
  /** Candidato único aguardando confirmação (partial_match) */
  pendingClientCandidate?: {
    id_cliente: number;
    nome: string;
    fantasia: string;
    documento: string;
    cidade_uf: string;
  } | null;
  /** Lista de 2–6 candidatos aguardando escolha do usuário (multiple) */
  pendingClientCandidates?: Array<{
    id_cliente: number;
    nome: string;
    fantasia: string;
    documento: string;
    cidade_uf: string;
  }> | null;
  /** Termo original da busca que gerou os candidatos */
  pendingClientSearchTerm?: string | null;
  /** Itens do orçamento pendentes para o candidato confirmado */
  pendingBudgetForCandidate?: OrcamentoAvulsoItem[] | null;
  /** Seleção de transportadora pendente — usuário escolhe por número (análogo ao endereço) */
  pendingFreightChoice?: {
    clientInternalId: number;
    clientName: string;
    enderecoId?: string | number;
    enderecoFull: string;
    cep?: string;
    cidade: string;
    uf: string;
    itens: Array<{
      id_produto: number;
      nome: string;
      quantidade: number;
      valorUnitario: number;
      valorFixo: number;
      subtotal: number;
      pesoUnitario: number;
    }>;
    subtotal: number;
    percentualBonus?: number;
    descontoReais?: number;
    subtotalLiquido?: number;
    pesoTotalGramas: number;
    fretes: Array<{
      id?: string;
      servico: string;
      transportadora: string;
      valor: number;
      prazo?: string;
      pesoUsado?: number;
      id_cotacao?: string;
    }>;
  } | null;
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
    activeQuote: null,
    pendingClientCandidate: null,
    pendingClientCandidates: null,
    pendingClientSearchTerm: null,
    pendingBudgetForCandidate: null,
    pendingFreightChoice: null,
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

// ─── Helpers P4: Detecção de Intenção sobre Cotação Ativa ──────────────────────────

export type QuoteQueryType =
  | 'subtotal'
  | 'total'
  | 'frete_sugerido'
  | 'transportadoras'
  | 'endereco'
  | 'itens'
  | 'peso'
  | 'resumo'
  | 'livre';

/**
 * Detecta pergunta sobre a cotação ativa.
 * Retorna o tipo da consulta ou null se não for sobre cotação.
 */
export function detectQuoteQuery(clean: string): QuoteQueryType | null {
  // Resumo geral
  if (/\b(me\s+resume|resumo\s+da\s+cota[cç]|resumo\s+do\s+or[cç]|o\s+que\s+tem\s+no\s+or[cç]|quais\s+itens|toda\s+a\s+cota[cç]|resume\s+tudo|mostra\s+a\s+cota[cç])\b/i.test(clean)) return 'resumo';
  // Peso — captura qualquer forma de pedir o peso
  if (/\b(peso\s+total|peso\s+considerado|peso\s+calculado|peso\s+usado|quantos\s+gramas|qual\s+o\s+peso|qual\s+peso|quanto\s+pesa|peso\s+do\s+or[cç]|peso\s+desse\s+or[cç]|peso\s+da\s+cota[cç]|gramas\s+calculados|peso|gramas|kg)\b/i.test(clean)) return 'peso';
  // Subtotal de produtos
  if (/\b(subtotal|valor\s+dos\s+produtos|quanto\s+ficou\s+(os\s+)?produtos|pre[cç]o\s+dos\s+produtos|valor\s+s[e\u00ea]m\s+frete)\b/i.test(clean)) return 'subtotal';
  // Total geral
  if (/\b(total\s+final|valor\s+total|qual\s+o\s+total|total\s+da\s+cota[cç]|total\s+do\s+or[cç]|total\s+agora|quanto\s+ficou|quanto\s+d[aá]|qual.*total)\b/i.test(clean)) return 'total';
  // Frete sugerido
  if (/\b(frete\s+sugerido|frete\s+selecionado|frete\s+escolhido|qual\s+frete\s+foi|qual\s+o\s+frete|frete\s+da\s+cota[cç]|frete\s+atual|qual\s+frete)\b/i.test(clean)) return 'frete_sugerido';
  // Transportadoras
  if (/\b(quais\s+transportadoras|transportadoras\s+apareceram|op[cç][oõ]es\s+de\s+frete|quais\s+fretes|quais\s+op[cç][oõ]es|quais\s+as\s+op[cç][oõ]es|transportadoras)\b/i.test(clean)) return 'transportadoras';
  // Endereço
  if (/\b(endere[cç]o\s+usado|qual\s+endere[cç]o\s+foi|endere[cç]o\s+da\s+cota[cç]|endere[cç]o\s+do\s+or[cç])\b/i.test(clean)) return 'endereco';
  // Itens
  if (/\b(quais\s+itens|itens\s+(da|do)\s+(cota[cç]|or[cç])|produtos\s+da\s+cota[cç]|o\s+que\s+foi\s+cotado)\b/i.test(clean)) return 'itens';
  return null;
}

/**
 * Detecta intenção de trocar frete dentro da cotação ativa.
 * Retorna o objeto frete encontrado, { notFound: true, mentioned: string },
 * { found: 'list' } para listar opções sem nome, ou null.
 */
export function detectFreightSwitch(
  clean: string,
  fretes: ActiveQuoteSnapshot['fretes']
): { found: true; frete: ActiveQuoteSnapshot['fretes'][0] } | { found: false; mentioned: string } | { found: 'list' } | null {
  // Padrões de troca de frete
  const switchPhrases = /\b(muda(r)?\s+para|mude\s+para|usa(r)?\s+(a|o)|use\s+(a|o)|troca(r)?\s+para|troque\s+para|coloca(r)?\s+(a|o)|prefiro|quero|escolhe(r)?|escolha|vai\s+de|vai\s+com|refaz\s+com)\b/i;
  const hasSwitch = switchPhrases.test(clean);
  const hasCarrierHint = /\b(mais\s+barato|mais\s+bara|sedex|pac|unesul|sao\s+miguel|motoboy|azul|correios|transportad)\b/i.test(clean);

  // "troca a transportadora" / "trocar transportadora" / "mudar transportadora" SEM nome específico
  // → retorna 'list' para mostrar seleção numerada novamente
  const isTrocaSemNome = /\b(troca(r)?|mudar?|muda)\s+(a\s+)?(transportadora|frete|entrega)\b/i.test(clean)
    && !hasCarrierHint
    && !switchPhrases.test(clean.replace(/\b(troca(r)?|mudar?|muda)\s+(a\s+)?(transportadora|frete|entrega)\b/i, ''));
  const isPedirOpcoes = /\b(trazer?|traga|mostrar?|mostre|listar?|liste|quero\s+(ver|as)\s+op).*(?:transportadora|frete|op[cç][aã]o)/i.test(clean)
    || /\b(op[cç][oõ]es?|opcoes?)\s+(de\s+)?(frete|transport)/i.test(clean);
  if (isTrocaSemNome || isPedirOpcoes) {
    return { found: 'list' };
  }

  if (!hasSwitch && !hasCarrierHint) {
    return null;
  }

  // "mais barato"
  if (/\b(mais\s+barato|mais\s+bara|menor\s+valor|menor\s+pre[cç]o)\b/i.test(clean)) {
    if (fretes.length === 0) return null;
    const maisBarato = [...fretes].sort((a, b) => a.valor - b.valor)[0];
    return { found: true, frete: maisBarato };
  }

  // "retira o frete" / "retira no balcao"
  if (/\b(retira\s+o\s+frete|tira\s+o\s+frete|sem\s+frete|retira(r)?\s+frete|tira(r)?\s+frete|frete\s+0|frete\s+zero|retira\s+no\s+balc[aã]o|retirar\s+no\s+balc[aã]o|tirar\s+o\s+frete|balc[aã]o)\b/i.test(clean)) {
    const retiraBalcao = fretes.find(f => f.id === 'retira_balcao');
    if (retiraBalcao) return { found: true, frete: retiraBalcao };
  }

  // Busca por nome da transportadora: lista conhecida primeiro, depois genérico após verbo de troca
  const knownMatch = clean.match(/\b(unesul|sao\s*miguel|sedex|pac|motoboy|azul\s*cargo|azul|correios\s+sedex|correios\s+pac|correios|braspress|jamef|total\s+express|tnt|fedex|dhl|loggi)\b/i);
  // Extração genérica: pega a palavra (ou expressão) logo após o verbo de troca
  const genericMatch = clean.match(/\b(?:mude?\s+para|use?\s+(?:a|o)|troque?\s+para|vou?\s+(?:com|de)|refaz\s+com|coloque?\s+(?:a|o)|escolha?|prefiro)\s+([a-záàâãéêíóôõúç][a-záàâãéêíóôõúç\s]{2,25}?)(?:\s*$|\s+(?:e|para|por|que|se|o|a|os|as))/i)
    ?? clean.match(/transportadora\s+([a-záàâãéêíóôõúç][a-záàâãéêíóôõúç\s]{2,30})/i);
  
  const mentionedRaw = knownMatch?.[0] ?? genericMatch?.[1] ?? '';
  const mentioned = mentionedRaw.trim();

  if (!mentioned) return null;

  const mentionedNorm = mentioned.toLowerCase().replace(/\s+/g, ' ');
  const frete = fretes.find(f => {
    const t = (f.transportadora ?? '').toLowerCase();
    const s = (f.servico ?? '').toLowerCase();
    return t.includes(mentionedNorm) || s.includes(mentionedNorm) ||
      mentionedNorm.includes(t.split(' ')[0]) || mentionedNorm.includes(s.split(' ')[0]);
  });

  if (frete) return { found: true, frete };
  if (mentioned) return { found: false, mentioned };
  return null;
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

  // ── P0. DELEGAÇÃO DE ESCOLHA NUMÉRICA PARA O ROUTER ──────────────────────
  if (v2Ctx.pendingAddressChoice || v2Ctx.pendingFreightChoice) {
    const isChoosing = /^(?:use|escolho|escolha|pode usar|quero)?\s*(?:o\s*|a\s*|endere[cç]o\s*|op[cç][aã]o\s*)?(\d+)\b/i.test(clean.trim());
    if (isChoosing) {
      console.log(`[MaestroV2Context] Escolha de endereço/frete detectada. Delegando ao router.`);
      return null;
    }
  }

  // ── P1. CONFIRMAÇÃO DE CLIENTE CANDIDATO PENDENTE ──────────────────────
  // PRIORIDADE MÁXIMA: se há candidato(s) pendente(s), "sim"/"esse"/código confirmam o
  // cliente pendente ANTES de qualquer lógica de save ou Brain.
  const hasPendingCandidate = !!(v2Ctx.pendingClientCandidate || v2Ctx.pendingClientCandidates?.length);
  if (hasPendingCandidate) {
    // Padrões de confirmação
    const isConfirmCandidato =
      /^(sim|isso|esse|esse mesmo|e esse|e isso|esta certo|correto|pode ser|ok|s|certo|quero esse|confirmo|confirmar)$/i.test(clean) ||
      /\b(esse mesmo|e esse|isso mesmo|ta certo|ta bom|pode ser esse)\b/i.test(clean);

    // Padrões de negação
    const isDenyCandidato =
      /^(nao|nao e esse|errado|outro|nao quero esse|outro cliente|diferente)$/i.test(clean) ||
      /\b(nao e esse|nao e isso|nao quero|outro cliente)\b/i.test(clean);

    // Código numérico: o usuário digitou um número (ex: "8469")
    const numericCodeMatch = clean.match(/^(\d+)$/);
    const numericCode = numericCodeMatch ? parseInt(numericCodeMatch[1], 10) : null;

    if (numericCode !== null) {
      // Tenta encontrar o candidato cujo id_cliente bate com o código informado
      let matchedById =
        (v2Ctx.pendingClientCandidate?.id_cliente === numericCode
          ? v2Ctx.pendingClientCandidate
          : null) ??
        v2Ctx.pendingClientCandidates?.find(c => c.id_cliente === numericCode) ??
        null;

      if (matchedById) {
        console.log(`[MaestroV2Context] Candidato confirmado por código ${numericCode}: ${matchedById.nome}`);
        v2Ctx.pendingClientCandidate = null;
        v2Ctx.pendingClientCandidates = null;
        v2Ctx.pendingClientSearchTerm = null;
        return {
          routed: true,
          plan: { steps: [{ tool: 'confirmar_cliente_pendente', params: { id_cliente: numericCode } }] }
        };
      }
      // Código não bate com nenhum candidato → deixa passar (pode ser nova busca por código)
    }

    if (isConfirmCandidato) {
      const candidato = v2Ctx.pendingClientCandidate ?? v2Ctx.pendingClientCandidates?.[0] ?? null;
      if (candidato) {
        console.log(`[MaestroV2Context] Candidato confirmado por afirmação: ${candidato.nome}`);
        v2Ctx.pendingClientCandidate = null;
        v2Ctx.pendingClientCandidates = null;
        v2Ctx.pendingClientSearchTerm = null;
        return {
          routed: true,
          plan: { steps: [{ tool: 'confirmar_cliente_pendente', params: { id_cliente: candidato.id_cliente } }] }
        };
      }
    }

    if (isDenyCandidato) {
      console.log('[MaestroV2Context] Candidato negado pelo usuário. Limpando candidatos pendentes.');
      v2Ctx.pendingClientCandidate = null;
      v2Ctx.pendingClientCandidates = null;
      v2Ctx.pendingClientSearchTerm = null;
      v2Ctx.pendingBudgetForCandidate = null;
      return {
        routed: true,
        plan: { steps: [{ tool: 'requisicao_nao_suportada', params: {} }] }
      };
    }

    // Há candidato pendente mas a mensagem não é confirmação nem negação:
    // bloquear Brain/fallback — delegar ao router que conhece os candidatos pendentes
    // mas deixar passar se for nova busca explícita de cliente
  }

  // ── P1.5 MENSAGENS SOCIAIS / CORTESIA
  if (v2Ctx.activeQuote || v2Ctx.pendingSaveQuotation) {
    const isSocialMessage = /^(ok[,.]?\s*|beleza[,.]?\s*|show[,.]?\s*|valeu[,.]?\s*|joia[,.]?\s*)?(muito\s+)?(bom dia|boa tarde|boa noite|obrigado|valeu|beleza|show|combinado|tks|thanks|perfeito|maravilha|joia|certo)(\s+mesmo)?([,.!]?\s*(pra voc[eê]|tamb[eé]m|amigo|maestro|pra ti|obrigado|pela ajuda|ajudou))?[.!?]*$/i.test(clean.trim());
    const isOnlyOk = /^(ok|beleza|show|valeu|combinado|certo|joia|maravilha|perfeito|ta|tá)[.!?]*$/i.test(clean.trim());

    if (isSocialMessage || isOnlyOk) {
      console.log('[MaestroV2Context] Mensagem social/cortesia detectada durante cotação/save pendente.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'resposta_social_cotacao', params: {} }] }
      };
    }
  }

  // ── P1.8 MENSAGENS DE FRUSTRAÇÃO / RECUPERAÇÃO DE CONTEXTO
  const isFrustration = /\b(meu\s+deus|voc[eê]\s+n[ãa]o\s+consegue|voc[eê]\s+n[ãa]o\s+entende|voc[eê]\s+se\s+perdeu|est[áa]\s+errado|nada\s+a\s+ver|burro|n[ãa]o\s+[eé]\s+isso|para\s+com\s+isso)\b/i.test(clean);
  if (isFrustration) {
    console.log('[MaestroV2Context] Frustração detectada. Limpando contexto de cotação e pedindo desculpas.');
    v2Ctx.activeQuote = null;
    v2Ctx.pendingSaveQuotation = null;
    v2Ctx.pendingAddressChoice = null;
    v2Ctx.pendingFreightChoice = null;
    v2Ctx.orcamentoItens = [];
    return {
      routed: true,
      plan: { steps: [{ tool: 'resposta_frustracao_usuario', params: {} }] }
    };
  }

  // ── P0. INTERCEPTAÇÃO DE CONFIRMAÇÃO DE SAVE (após P1)
  if (v2Ctx.pendingSaveQuotation && !v2Ctx.pendingSaveQuotation.savedIdInt) {
    const isCancelar = /\b(cancela(r)?|n[ãa]o\s+(vou\s+|quero\s+)?(salva(r)?|valsa(r)?)(?:\s+agora)?|n[ãa]o\s+quero\s+salvar|descarta(r)?|abort(a|ar)?)\b/i.test(clean)
      || /^(cancela(r)?|n[ãa]o|nao|n)$/i.test(clean);
      
    // Melhorar regex de salvar para não dar match em frases negadas se checado fora de ordem
    const isSalvar = /\b(salvar?\s+cota[cç]a[oã]|salva(r)?|valsa(r)?|confirmar?\s+save|sim[,.]?\s*(salva|quero\s+salvar?|pode\s+salvar?))\b/i.test(clean)
      || /^(salvar?\s+cota[cç]a[oã]|salva(r)?|valsa(r)?|quero\s+salvar?|confirmar?|pode\s+salvar?|sim|s)$/i.test(clean);
      
    const isEditarAntes = /\b(editar?\s+antes|quero\s+editar?|edita(r)?\s+primeiro|ajustar?\s+antes)\b/i.test(clean)
      || /^(editar?\s+antes|edita(r)?)$/i.test(clean);

    if (isCancelar) {
      console.log('[MaestroV2Context] Cancelamento de save detectado.');
      if (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
        v2Ctx.lastExplicitBudgetItems = [...v2Ctx.orcamentoItens];
      }
      v2Ctx.pendingSaveQuotation = null;
      v2Ctx.activeQuote = null;
      v2Ctx.pendingFreightChoice = null;
      v2Ctx.pendingAddressChoice = null;
      v2Ctx.budgetAddressId = undefined;
      v2Ctx.budgetAddressFull = undefined;
      v2Ctx.budgetAddressCep = undefined;
      v2Ctx.budgetAddressCidade = undefined;
      v2Ctx.budgetAddressUf = undefined;
      
      const hasCompoundIntent = /\b(fazer|fa[cç]a|gerar|gera|simula|simular|repete|repetir|faz|cli\s+\d+|cliente|busca|outro\s+cli)\b/i.test(clean);
      if (hasCompoundIntent) {
         console.log('[MaestroV2Context] Cancelamento possui intenção composta, limpando contexto e seguindo o fluxo normal.');
         return null; // Deixa o Router lidar com a repetição de cotação / troca de cliente
      }
      
      return {
        routed: true,
        plan: { steps: [{ tool: 'cancelar_save_cotacao', params: {} }] }
      };
    }

    if (isSalvar) {
      console.log('[MaestroV2Context] Confirmação de save detectada.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'salvar_cotacao_confirmada', params: {} }] }
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

  // Proposta já salva — retorna link sem duplicar (apenas para pedido explícito de save)
  if (v2Ctx.pendingSaveQuotation?.savedIdInt) {
    const isSalvarDuplicado = /\b(salvar?\s+cota[cç]a[oã]|salva(r)?)\b/i.test(clean);
    if (isSalvarDuplicado) {
      return {
        routed: true,
        plan: { steps: [{ tool: 'proposta_ja_salva', params: {} }] }
      };
    }
    // Perguntas sobre frete pós-save são tratadas pelo P4 abaixo (activeQuote)
  }

  // ── P3.4: TROCA DE ENDEREÇO DURANTE COTAÇÃO ────────────────────────────────
  const isChangeAddress = /\b(outro\s+endere[cç]o|endere[cç]o\s+(n[aã]o|t[aá])\s+(est[aá]\s+)?(certo|errado)|mostr[ea]\s+(os\s+)?endere[cç]os|trocar?\s+endere[cç]o|mudar?\s+endere[cç]o)\b/i.test(clean);
  if (isChangeAddress && (v2Ctx.activeQuote || v2Ctx.pendingFreightChoice || v2Ctx.pendingSaveQuotation || v2Ctx.budgetAddressId)) {
    console.log(`[MaestroV2Context] P3.4: Mudança de endereço solicitada.`);
    // Limpa a escolha de frete e cotação ativa para forçar recálculo e nova escolha
    v2Ctx.pendingFreightChoice = null;
    v2Ctx.activeQuote = null;
    v2Ctx.pendingSaveQuotation = null;
    v2Ctx.budgetAddressId = undefined;
    v2Ctx.budgetAddressFull = undefined;
    v2Ctx.budgetAddressCep = undefined;
    v2Ctx.budgetAddressCidade = undefined;
    v2Ctx.budgetAddressUf = undefined;
    
    // Retorna para simularOrcamentoAvulso que vai naturalmente detectar a falta de endereço
    // e perguntar os endereços novamente.
    return {
      routed: true,
      plan: { steps: [{ tool: 'simularOrcamentoAvulso', params: {} }] }
    };
  }

  // ── P3.5: ESCOLHA DE TRANSPORTADORA PENDENTE (análogo ao endereço) ─────────
  // Se há seleção de transportadora pendente e usuário digitou um número, confirmar
  if (v2Ctx.pendingFreightChoice) {
    const isChoosing = /^(?:(?:use?|escolho|quero|pode|coloca|opç[aã]o)\s+(?:a\s+|o\s+|))?(?:op[cç][aã]o\s+)?(\d+)\b/i.exec(clean.trim());
    if (isChoosing) {
      const idx = parseInt(isChoosing[1], 10);
      console.log(`[MaestroV2Context] P3.5: escolha de transportadora índice ${idx}`);
      return {
        routed: true,
        plan: { steps: [{ tool: 'confirmar_frete_cotacao', params: { freteIndex: idx } }] }
      };
    }

    // Tenta detectar escolha por nome
    const freightResult = detectFreightSwitch(clean, v2Ctx.pendingFreightChoice.fretes as any);
    if (freightResult !== null) {
      if (freightResult.found === true) {
        const idx = v2Ctx.pendingFreightChoice.fretes.findIndex((f: any) => f.id === freightResult.frete.id) + 1;
        console.log(`[MaestroV2Context] P3.5: escolha de transportadora por nome (${freightResult.frete.transportadora}) -> índice ${idx}`);
        return {
          routed: true,
          plan: { steps: [{ tool: 'confirmar_frete_cotacao', params: { freteIndex: idx } }] }
        };
      } else if (freightResult.found === false) {
        console.log(`[MaestroV2Context] P3.5: frete mencionado não disponível: ${freightResult.mentioned}`);
        return {
          routed: true,
          plan: { steps: [{ tool: 'frete_nao_disponivel', params: { mentioned: freightResult.mentioned } }] }
        };
      }
    }
  }

  // ── P4. PERGUNTA OU ALTERAÇÃO SOBRE COTAÇÃO ATIVA ────────────────────────
  // Ativa somente quando há snapshot de cotação (salva ou não).
  // Não intercepta candidatos pendentes (já tratados em P1).
  if (v2Ctx.activeQuote) {
    // 4a. Consulta sobre dados da cotação
    const quoteQueryType = detectQuoteQuery(clean);
    if (quoteQueryType) {
      console.log(`[MaestroV2Context] P4: consulta sobre cotação ativa (${quoteQueryType}).`);
      return {
        routed: true,
        plan: { steps: [{ tool: 'consultar_cotacao_ativa', params: { query: quoteQueryType } }] }
      };
    }

    // 4b. "e o orçamento?" / "o que tem no orçamento?" quando há cotação ativa não salva
    if (
      v2Ctx.activeQuote.status === 'nao_salva' &&
      /\b(e\s+o\s+or[cç]amento|e\s+a\s+cota[cç]|o\s+or[cç]amento|sobre\s+(o|a)\s+cota[cç]|sobre\s+o\s+or[cç])\b/i.test(clean)
    ) {
      console.log('[MaestroV2Context] P4: consulta resumo da cotação ativa (não salva).');
      return {
        routed: true,
        plan: { steps: [{ tool: 'consultar_cotacao_ativa', params: { query: 'resumo' } }] }
      };
    }

    // 4c. Troca de frete
    if (v2Ctx.activeQuote.status === 'nao_salva') {
      const freightResult = detectFreightSwitch(clean, v2Ctx.activeQuote.fretes);
      if (freightResult !== null) {
        if (freightResult.found === 'list') {
          // Usuário pediu troca sem especificar nome → re-mostra seleção numerada
          console.log('[MaestroV2Context] P4: troca de frete sem nome — re-exibindo lista numerada.');
          return {
            routed: true,
            plan: { steps: [{ tool: 'exibir_lista_fretes', params: {} }] }
          };
        } else if (freightResult.found === true) {
          console.log(`[MaestroV2Context] P4: troca de frete para ${freightResult.frete.transportadora}.`);
          return {
            routed: true,
            plan: { steps: [{ tool: 'trocar_frete_cotacao_ativa', params: { freteId: freightResult.frete.id } }] }
          };
        } else {
          console.log(`[MaestroV2Context] P4: frete mencionado não disponível: ${freightResult.mentioned}.`);
          return {
            routed: true,
            plan: { steps: [{ tool: 'frete_nao_disponivel', params: { mentioned: freightResult.mentioned } }] }
          };
        }
      }
    }

    // 4d. Pedido de troca de endereço na cotação ativa
    if (
      v2Ctx.activeQuote.status === 'nao_salva' &&
      /\b(mudar?\s+endere[cç]o|outro\s+endere[cç]o|endere[cç]o\s+diferente|trocar?\s+endere[cç]o|mudar?\s+o\s+endere[cç]o)\b/i.test(clean)
    ) {
      console.log('[MaestroV2Context] P4: troca de endereço solicitada na cotação ativa.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'iniciar_troca_endereco_cotacao', params: {} }] }
      };
    }

    // 4e. Fallback genérico — NÃO intercepta se for mudança explícita de assunto ou busca de outro cliente
    const isMudancaAssunto = /\b(mudei\s+de\s+assunto|outro\s+assunto|deixa\s+a\s+cota|esquece\s+a\s+cota|esquece\s+isso)\b/i.test(clean);
    // Detecta "sobre o cliente [Nome]" ou "e o cliente [Nome]" com nome próprio (palavra com maiúscula ou só nome)
    const isBuscaOutroCliente = /\b(sobre\s+o\s+cliente|e\s+o\s+cliente|e\s+cliente|buscar?\s+cliente|cliente\s+[a-záàâãéêíóôõúç]{3,}|cli\s+\d+|cliente\s+\d{3,}|sobre\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]{2,}|sobre\s+a\s+empresa)\b/.test(query);
    const isNewQuoteOrClient = /\b(cota[cç]ão\s+para|cot[ei]|fazer\s+or[cç]|buscar\s+cli|cli\s+\d+|cpf|cnpj|mesmo\s+or[cç]amento)\b/i.test(clean);
    const isSaveCommand = /\b(sim|salva|grava|confirma|pode\s+salvar|salvar\s+agora|save)\b/i.test(clean);
    
    // Detecta comandos de edição de itens: "900 mobi", "só 900 mobi", "1000 mobi e 900 tex", "muda mobi para 900"
    const isItemEdit = /\b(muda|altera|troca|atualiza|recalcula|recalcule|sao|são|corrige|refazer\s+com|faz\s+com|troca\s+para|so|só|apenas)\b/i.test(clean)
      || /^(?:só|so|apenas|são|sao)?\s*\d+(?:\.\d+)?k?\s+[a-z][a-z\d\s-]+/i.test(clean.trim())
      || /\b\d+(?:\.\d+)?k?\s+[a-z][a-z\d\s-]+\s+(e|ou|mais|,|\+)\s+\d+(?:\.\d+)?k?\s+[a-z]/i.test(clean);

    if (!isMudancaAssunto && !isBuscaOutroCliente && !isNewQuoteOrClient && !isSaveCommand && !isItemEdit && clean.length > 2) {
      console.log('[MaestroV2Context] P4: pergunta livre com cotação ativa — roteando para consulta com contexto completo.');
      return {
        routed: true,
        plan: { steps: [{ tool: 'consultar_cotacao_ativa', params: { query: 'livre' } }] }
      };
    }
  }

  // ── 1. CANCELAMENTO DO ORÇAMENTO AVULSO (PRIORIDADE CRÍTICA)
  const isCancelOrcamento = /\b(nao\s*(quero|e)\s*orca(r|mento)|esquece\s*orca(r|mento))\b/i.test(clean);
  if (isCancelOrcamento) {
    console.log('[MaestroV2Context] Ação: Cancelamento de orçamento avulso solicitado.');
    if (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
      v2Ctx.lastExplicitBudgetItems = [...v2Ctx.orcamentoItens];
    }
    v2Ctx.orcamentoItens = [];
    v2Ctx.pendingProductResolution = null;
    v2Ctx.pendingAmbiguousItem = null;
    v2Ctx.pendingSaveQuotation = null;
    v2Ctx.activeQuote = null;
    v2Ctx.pendingFreightChoice = null;
    v2Ctx.pendingAddressChoice = null;
    v2Ctx.budgetAddressId = undefined;
    v2Ctx.budgetAddressFull = undefined;
    v2Ctx.budgetAddressCep = undefined;
    v2Ctx.budgetAddressCidade = undefined;
    v2Ctx.budgetAddressUf = undefined;
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

    // Se houver pedido para usar o mesmo orçamento, preserva itens mas limpa a cotação
    const isMesmoOrcamento = /\b(mesmo\s+(or[cç]amento|pedido|cota[cç][aã]o)|mesma\s+cota[cç][aã]o|repete\s+(esse\s+)?or[cç]amento)\b/i.test(clean) || /\b(agora\s+fa[cç]a\s+o\s+mesmo\s+or[cç]amento)\b/i.test(clean);
    
    if (isMesmoOrcamento) {
      console.log('[MaestroV2Context] Intenção "mesmo orçamento" detectada. Preservando itens e limpando cotação anterior.');
      const sourceItens = v2Ctx.activeQuote?.itens || v2Ctx.pendingSaveQuotation?.itens || v2Ctx.orcamentoItens || [];
      v2Ctx.orcamentoItens = sourceItens.map((it: any) => ({
        id_produto: it.id_produto,
        nome: it.nome,
        quantidade: it.quantidade,
        valorUnitario: it.valorUnitario,
        valorFixo: it.valorFixo,
        subtotal: it.subtotal,
        pesoUnitario: it.pesoUnitario,
        termo: it.termo || it.nome
      }));
    } else {
      v2Ctx.orcamentoItens = [];
    }

    // Limpa estado operacional amarrado ao cliente anterior
    v2Ctx.activeQuote = null;
    v2Ctx.pendingSaveQuotation = null;
    v2Ctx.pendingAddressChoice = null;
    v2Ctx.pendingFreightChoice = null;

    return null;
  }


  // ── 3. PERGUNTAS CONTEXTUAIS DE CLIENTE ATIVO (PRIORIDADE ALTA)
  if (activeClient) {
    // Verifica se a mensagem contém palavras chave de relacionamento/dados cadastrais
    const hasClientFieldKeyword = /\b(endereco|enderecos|contato|contatos|telefone|whats|whatsapp|email|e-mail|vinculo|vinculos|socio|socios|dele|desse cliente|dessa empresa|onde entrega|entrega|bonus|bônus|b[oô]nus)\b/i.test(clean);
    
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
      } else if (/\b(bonus|bônus|b[oô]nus)\b/i.test(clean)) {
        campo = 'bonus';
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

