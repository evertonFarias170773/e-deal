/**
 * maestro-simple-intents.ts
 *
 * Detector de intenção por FAMÍLIAS para o Maestro Simple v1.
 *
 * Princípios:
 * 1. Normaliza TODO o texto antes de detectar (lowercase + sem acentos + sem pontuação)
 * 2. Trabalha com FAMÍLIAS, não frases exatas nem regexes isoladas
 * 3. Código de cliente é detectado em qualquer posição da frase
 * 4. Pontuação NUNCA quebra a detecção
 *
 * Famílias implementadas:
 *   client_lookup           → localizar cliente por código/doc/nome
 *   client_summary          → "me conte sobre esse cliente" / "faz um resumo"
 *   client_field_question   → pergunta sobre campo específico do cliente ativo
 *   client_confirmation     → "tem certeza?" / "qual a fonte?"
 *   client_unknown_field    → referência ao cliente mas campo não mapeado
 *   client_history_question → histórico comercial (Fase 2 — não implementado)
 *   client_switch           → "troca para o cliente 123"
 *   help                    → ajuda / "o que você faz"
 *   fallback                → nenhuma das acima
 */

// ─── Tipos de Intenção ─────────────────────────────────────────────────────

export type SimpleIntent =
  | 'client_lookup'           // localizar cliente por código / doc / nome
  | 'client_summary'          // resumo geral do cliente ativo
  | 'client_field_question'   // campo específico (telefone, cidade, CNPJ...)
  | 'client_confirmation'     // "tem certeza?" / "qual a fonte?"
  | 'client_contacts_question'// "quem são os contatos?" / "quem compra?"
  | 'client_partners_question'// "empresas autorizadas" / "sócios"
  | 'client_unknown_field'    // referência ao cliente mas campo não reconhecido
  | 'client_history_question' // histórico comercial — stub legado
  | 'client_switch'           // trocar cliente ativo
  // ── Fase 2: Pedidos e Financeiro ──────────────────────────────────────────
  | 'client_recent_orders'    // últimos pedidos reais do cliente
  | 'client_revenue_period'   // faturamento/soma de pedidos por período
  | 'client_biggest_order'    // pedido de maior valor
  | 'client_open_proposals'   // propostas não aprovadas para produção
  | 'client_boletos_status'   // boletos em aberto / atraso / não liquidados
  | 'help'
  | 'closure'
  | 'wait_user'
  | 'fallback';

export interface MaestroPeriodo {
  start?: string;
  end?: string;
  label: string;
  tipo: 'mes_atual' | 'ultimos_30_dias' | 'mes_passado' | 'dinamico';
}

export interface DetectedIntent {
  type: SimpleIntent;
  /** Para client_lookup: código numérico (ex: "8469") */
  code?: string;
  /** Para client_lookup por doc: CPF/CNPJ no formato original */
  document?: string;
  /** Tipo de documento detectado */
  documentType?: 'cpf' | 'cnpj';
  /** Se o documento é parcial (menos que o tamanho padrão) */
  documentPartial?: boolean;
  /** Para client_lookup por nome: nome textual */
  name?: string;
  /** Para client_field_question: campo detectado */
  field?: string;
  /** Para client_revenue_period ou client_recent_orders: período de faturamento */
  periodo?: MaestroPeriodo;
  /** Para client_boletos_status: tipo de filtro de boletos */
  filtro?: 'aberto' | 'atraso' | 'nao_liquidado' | 'todos';
}

// ─── Tolerância a Erros de Digitação (Typo Dictionary) ─────────────────────

/**
 * Dicionário controlado de correções comuns (aliases).
 * Aplicado após a remoção de acentos e pontuação, operando em palavras exatas (\b).
 * Não inclui números, CPFs ou IDs para garantir segurança.
 */
const TYPO_DICTIONARY: Record<string, string> = {
  'com dia': 'bom dia',
  'bon dia': 'bom dia',
  'bom fia': 'bom dia',
  'clite': 'cliente',
  'cliiente': 'cliente',
  'clinte': 'cliente',
  'clente': 'cliente',
  'pedids': 'pedidos',
  'pedid': 'pedido',
  'pedodo': 'pedido',
  'pedodos': 'pedidos',
  'pediso': 'pedido',
  'utimos': 'ultimos',
  'boleo': 'boleto',
  'bolto': 'boleto',
  'faturameto': 'faturamento',
};

// ─── Normalização ──────────────────────────────────────────────────────────

/**
 * Normaliza para detecção de intenção:
 * - lowercase
 * - remove acentos (NFD → strip combining chars)
 * - remove pontuação (preserva letras, dígitos, espaços)
 * - colapsa espaços extras
 * - aplica dicionário de correções comuns (typos)
 *
 * Usar SEMPRE antes de comparar com triggers. Apenas afeta a detecção,
 * não o texto original enviado ao LLM.
 */
export function normalizeForDetection(text: string): string {
  let normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\d\s]/g, ' ')      // remove pontuação, preserva letras e dígitos
    .replace(/\s+/g, ' ')
    .trim();

  // Aplica correções seguras de digitação
  for (const [typo, correction] of Object.entries(TYPO_DICTIONARY)) {
    // Usamos \\b para garantir que só substitui a palavra/frase exata
    const regex = new RegExp(`\\b${typo}\\b`, 'g');
    normalized = normalized.replace(regex, correction);
  }

  return normalized;
}

// ─── Padrões de Código de Cliente ─────────────────────────────────────────

/**
 * Detecta código numérico de cliente em QUALQUER posição da frase.
 * Ordem importa: anchorados primeiro (maior precisão), não-anchorados depois.
 */
const CLIENT_CODE_PATTERNS = [
  // Anchorados — maior prioridade (frase começa com o gatilho)
  /^cliente\s+(\d{1,})\b/,
  /^cli\s+(\d{1,})\b/,
  /^cadastro\s+(\d{1,})\b/,
  /^cad\s+(\d{1,})\b/,
  /^c(\d{1,})$/,          // c14 (exato — sem espaço)
  /^#(\d{1,})$/,          // #14 (exato)
  // Não anchorados — código no meio da frase
  /\bcliente\s+(\d{1,})\b/,
  /\bcli\s+(\d{1,})\b/,
  /\bcad(?:astro)?\s+(\d{1,})\b/,
];

// CNPJ: 00.000.000/0000-00 ou variações sem pontuação
const CNPJ_RE = /\b(\d{2}\.?\d{3}\.?\d{3}\/?(?:\d{4})-?\d{2})\b/;
// CPF: 000.000.000-00 ou variações sem pontuação (11 dígitos)
const CPF_RE = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/;

/**
 * Prefixo explícito de documento: captura CPF/CNPJ parcial ou completo.
 * Ex: "cpf 671490" → { type: 'client_lookup', document: '671490', documentType: 'cpf' }
 * Ex: "cnpj 93015006" → { type: 'client_lookup', document: '93015006', documentType: 'cnpj' }
 */
const CPF_PREFIX_RE = /\bcpf\s+(\d{3,11})\b/;
const CNPJ_PREFIX_RE = /\bcnpj\s+(\d{4,14})\b/;

// ─── Famílias de Gatilhos ──────────────────────────────────────────────────

// ─── Famílias de Gatilhos Mínimas ──────────────────────────────────────────

/** Verbos/frases que indicam busca de cliente mesmo sem "cliente" explícito */
const LOOKUP_VERBS = [
  'busca', 'abre', 'carrega', 'puxa', 'procura', 'localiza', 'encontra',
  'consulta', 'mostra', 'quero ver', 'info do', 'informacao do',
  'dados do', 'dados de', 'ficha do', 'ficha de',
  'me fala do cliente', 'sobre o cliente', 'quem e o cliente',
];

/** Frases que indicam troca de cliente ativo */
const SWITCH_TRIGGERS = [
  'troca para', 'troca o cliente', 'agora cliente', 'agora o cliente',
  'nao e esse', 'outro cliente', 'consulta outro', 'muda para o cliente',
  'muda o cliente', 'trocar para', 'muda para cliente', 'esse nao',
];

/** Frases de confirmação / questionamento de fonte */
const CONFIRMATION_TRIGGERS = [
  'tem certeza', 'confirma', 'confere', 'qual a fonte', 'de onde veio',
  'como voce sabe', 'por que disse', 'dado correto', 'ta certo',
  'ta correto', 'isso esta certo', 'isso esta correto', 'fonte do dado',
  'origem do dado', 'como sabe disso', 'de onde tirou', 'essa informacao veio',
];

/** Gatilhos de ajuda */
const HELP_TRIGGERS = [
  'ajuda', 'help', 'o que voce faz', 'como usar', 'como funciona',
  'quais sao suas funcoes', 'oi ', 'ola', 'bom dia', 'boa tarde', 'boa noite',
  'inicio', 'comecar',
];

/** Gatilhos de encerramento / agradecimento */
const CLOSURE_TRIGGERS = [
  // Agradecimentos
  'obrigado', 'obrigada', 'valeu',
  // Confirmações positivas
  'perfeito', 'esta otimo', 'tudo certo', 'era isso',
  'ok obrigado',
  // Encerramento simples (incluídos para evitar Brain com fatos falsos)
  'show', 'beleza',
  'ok',             // ← acknowledgement simples
  'blz',            // ← "beleza" abreviado
  'certo',          // ← confirmação
  'combinado',      // ← encerramento
  'entendido',      // ← acknowledgement
  'ta bom',         // ← confirmação coloquial
  'ta',             // ← encerramento coloquial
  'fechou',         // ← encerramento comercial
  'ótimo',          // ← com acento (normalizado)
  'otimo',          // ← sem acento
  'ate mais',       // ← despedida
  'ate logo',       // ← despedida
  'tcau',           // ← tchau normalizado
];

/** Gatilhos de aguardo / pausa do usuário */
const WAIT_USER_TRIGGERS = [
  'vou ver aqui', 'ja te passo', 'calma', 'ja to vendo',
  'pera ai', 'um momento', 'vou procurar', 'vou conferir',
  'ja volto', 'aguarde', 'deixa eu ver'
];

// ─── Detector Principal ───────────────────────────────────────────────────

export function detectIntent(query: string): DetectedIntent {
  // Normaliza para comparações (sem acentos, sem pontuação, lowercase)
  const norm = normalizeForDetection(query);

  // ── 2. Encerramento / Agradecimento ─────────────────────────────────────
  // Deve ser checado antes de fields para evitar falsos positivos
  if (CLOSURE_TRIGGERS.some(t => norm === t || norm.startsWith(t) || norm.endsWith(t) || norm.includes(t))) {
    // Validação extra: não deve conter palavras de busca (para evitar conflito com "ok busca o cliente X")
    const isActuallySearching = LOOKUP_VERBS.some(v => norm.includes(v)) ||
      norm.includes('cliente') ||
      /\b(liente|clinte|ciente|cli|cadastro)\s+[a-z]/i.test(norm);
    if (!isActuallySearching) {
      return { type: 'closure' };
    }
  }

  // ── 2a. Aguardo / Pausa ─────────────────────────────────────────────────
  if (WAIT_USER_TRIGGERS.some(t => norm === t || norm.startsWith(t) || norm.endsWith(t) || norm.includes(t))) {
    return { type: 'wait_user' };
  }

  // ── 1. Troca de cliente ──────────────────────────────────────────────────
  if (SWITCH_TRIGGERS.some(t => norm.includes(t))) {
    for (const pattern of CLIENT_CODE_PATTERNS) {
      const m = norm.match(pattern);
      if (m) return { type: 'client_switch', code: m[1] };
    }
    return { type: 'client_switch' };
  }

  // ── 2. Busca de cliente por código (qualquer posição da frase) ───────────
  for (const pattern of CLIENT_CODE_PATTERNS) {
    const m = norm.match(pattern);
    if (m) return { type: 'client_lookup', code: m[1] };
  }

  // ── 2b. Verbo de localização + número → client_lookup ───────────────────
  if (LOOKUP_VERBS.some(v => norm.includes(v))) {
    const num = norm.match(/\b(\d{3,})\b/);
    if (num) return { type: 'client_lookup', code: num[1] };
  }

  // ── 2c. Prefixo explícito CPF/CNPJ (parcial ou completo) ─────────────────
  // Capturado ANTES da regex pura para garantir que o prefixo seja reconhecido
  const cpfPrefixMatch = norm.match(CPF_PREFIX_RE);
  if (cpfPrefixMatch) {
    const docDigits = cpfPrefixMatch[1].replace(/\D/g, '');
    return { type: 'client_lookup', document: docDigits, documentType: 'cpf', documentPartial: docDigits.length < 11 };
  }
  const cnpjPrefixMatch = norm.match(CNPJ_PREFIX_RE);
  if (cnpjPrefixMatch) {
    const docDigits = cnpjPrefixMatch[1].replace(/\D/g, '');
    return { type: 'client_lookup', document: docDigits, documentType: 'cnpj', documentPartial: docDigits.length < 14 };
  }

  // ── 3. CNPJ / CPF (no texto original para preservar pontuação) ───────────
  const rawLower = query.toLowerCase().trim();
  const cnpjMatch = rawLower.match(CNPJ_RE);
  if (cnpjMatch) return { type: 'client_lookup', document: cnpjMatch[1] };
  const cpfMatch = rawLower.match(CPF_RE);
  if (cpfMatch) return { type: 'client_lookup', document: cpfMatch[1] };

  // ── 4. Nome textual após gatilho de busca ────────────────────────────────
  // Ex: "cliente Empresa ABC" / "liente Empresa XYZ" (typo aceito)
  const nameM = norm.match(
    /\b(?:cliente|cli|cadastro|liente|clinte|ciente|busca|procura|localiza|encontra|consulta)\s+([a-z][a-z\d\s]{2,30})/
  );
  if (nameM) {
    const candidate = nameM[1].trim();
    // Evita falsos positivos com pronomes
    const refWords = ['ele', 'ela', 'dele', 'dela', 'desse', 'deste', 'do cliente'];
    if (!refWords.includes(candidate) && !/^\d+$/.test(candidate)) {
      return { type: 'client_lookup', name: candidate };
    }
  }

  // ── 4b. "sobre o/a <nome>" como busca de cliente ────────────────────────
  // Ex: "sobre o Zaffari", "sobre a Maria", "sobre Edison Santos"
  // Detecta quando NÃO for campo contextual (telefone, e-mail etc.)
  const sobreNomeM = norm.match(/\bsobre\s+(?:o|a|os|as)?\s*([a-z][a-z\u00e0-\u00ff\s]{2,40})$/);
  if (sobreNomeM) {
    const candidatoNome = sobreNomeM[1].trim();
    // Campos contextuais: quando o usuário pergunta sobre dados do cliente ativo
    const camposCtx = [
      'telefone', 'email', 'e-mail', 'endereco', 'enderecos', 'contato', 'contatos',
      'socio', 'socios', 'boleto', 'boletos', 'bonus', 'limite', 'credito',
      'vendedor', 'restricao', 'ativo', 'status', 'cnpj', 'cpf'
    ];
    const ehCampoContextual = camposCtx.some(c => candidatoNome.includes(c));
    // Pronomes de referência ao cliente ativo
    const refWords = ['ele', 'ela', 'dele', 'dela', 'desse', 'deste', 'do cliente', 'essa empresa'];
    const ehReferencia = refWords.some(r => candidatoNome.includes(r));

    if (!ehCampoContextual && !ehReferencia && candidatoNome.length >= 3) {
      return { type: 'client_lookup', name: candidatoNome };
    }
  }

  // ── 5. Confirmação ────────────────────────────────────────────────────────
  if (CONFIRMATION_TRIGGERS.some(t => norm.includes(t))) {
    return { type: 'client_confirmation' };
  }

  // ── 6. Ajuda ─────────────────────────────────────────────────────────────
  if (HELP_TRIGGERS.some(t => norm.includes(t))) {
    return { type: 'help' };
  }

  // ── 7. Fallback (Tudo o que for semântico ou não mapeado acima) ──────────
  return { type: 'fallback' };
}
