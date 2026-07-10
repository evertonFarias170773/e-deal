/**
 * maestro-orcamento-catalogo-oficial.ts
 *
 * Catálogo oficial de produtos operacionais da Ingresso Ideal.
 *
 * RESPONSABILIDADE:
 *   Mapear termos digitados pelo usuário para id_produto oficial.
 *   NÃO é fonte de preço, não é fonte de valorUnt/valorFixo.
 *   Preço e status SEMPRE vêm de public.produtos (banco real).
 *
 * REGRA DE RESOLUÇÃO:
 *   1. ID explícito do produto informado pelo usuário
 *   2. Alias exato no catálogo oficial (esta lista)
 *   3. Alias parcial seguro neste catálogo
 *   4. public.produtos.apelidos (banco)
 *   5. public.produtos.descricao como fallback (banco)
 *
 * REGRA DE PRODUTO INATIVO:
 *   Se ativo=false, retornar tipoMatch='inativo'.
 *   O engine NUNCA deve cotar produto inativo sem avisar o usuário.
 *
 * REGRA DE ALIAS GENÉRICO/AMBÍGUO:
 *   Termos genéricos (ex: "cordão", "pulseira") retornam tipoMatch='generico'
 *   e uma sugestão de confirmação para o usuário escolher.
 *
 * Normalização: lowercase, sem acentos, sem pontuação.
 *   Ex: "Triband" → "triband", "Cordão Jacaré" → "cordao jacare"
 *
 * IDs REAIS confirmados em public.produtos em 2026-07-09 (somente leitura).
 * Atualizar esta lista apenas quando produto muda de ID ou nome comercial.
 * Preço nunca vem daqui.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProdutoCatalogoOficial {
  /** ID real em public.produtos */
  id_produto: number;
  /** Nome comercial oficial (campo nomeReal no banco) */
  nomeComercial: string;
  /** Categoria comercial */
  categoria: string;
  /**
   * Aliases aceitos — todos em lowercase sem acento.
   * O primeiro alias é o canônico (preferido em mensagens).
   * REGRA: nunca incluir alias genérico aqui se puder causar ambiguidade.
   */
  aliases: string[];
  /**
   * Se false, o produto está inativo em public.produtos.
   * O engine deve avisar o usuário e NÃO cotar diretamente.
   * Se omitido, assume true (ativo).
   */
  ativo?: boolean;
}

// ─── Catálogo de Aliases Genéricos (requerem confirmação) ─────────────────────

/**
 * Aliases genéricos que não devem resolver para um produto específico sem confirmação.
 * Quando o usuário digitar um desses termos sozinhos, o Maestro deve listar opções.
 * Chaves: normalizados (sem acentos, lowercase).
 */
export const ALIASES_AMBIGUOS: Record<string, { opcoes: string[]; sugestao: string }> = {
  'cordao': {
    opcoes: ['Jacaré (cordão simples)', 'Mosquete Metal', 'Mosquete Plástico', 'Argola'],
    sugestao: 'Encontrei vários tipos de cordão. Qual você quer: Jacaré, Mosquete Metal, Mosquete Plástico ou Argola?',
  },
  'pulseira': {
    opcoes: ['Triband', 'ColorBand', 'TexBand', 'Bracelete', 'Botão/Pino'],
    sugestao: 'Encontrei vários tipos de pulseira. Qual você quer: Triband, ColorBand, TexBand, Bracelete ou Botão/Pino?',
  },
  'cracha': {
    opcoes: ['Cartão/Crachá PVC 0,76mm (ID 801)', 'Credencial PVC (ID 901)'],
    sugestao: 'Encontrei mais de uma opção de crachá. Você quer o Cartão PVC rígido (801) ou a Credencial PVC (901)?',
  },
  'pvc': {
    opcoes: ['Cartão/Crachá PVC 0,76mm (ID 801)', 'Credencial PVC (ID 901)'],
    sugestao: 'Encontrei mais de uma opção PVC. Você quer Cartão PVC rígido (801) ou Credencial PVC (901)?',
  },
};

/**
 * Verifica se o termo é um alias genérico/ambíguo que requer confirmação.
 */
export function verificarAliasGenerico(termo: string): { opcoes: string[]; sugestao: string } | null {
  const norm = normalizarTermoCatalogo(termo);
  return ALIASES_AMBIGUOS[norm] ?? null;
}

// ─── Catálogo Operacional ─────────────────────────────────────────────────────

/**
 * Lista oficial de produtos com aliases.
 * Cada alias mapeia para um único id_produto.
 * IDs confirmados em public.produtos em 2026-07-09.
 *
 * ATENÇÃO: O produto 9001 (TesteBand) tem aliases 'tri', 'band', 'pulseira' no banco.
 * O catálogo oficial tem prioridade sobre os aliases do banco.
 * 'tri' aqui → 101 (Triband Sintética), não 9001 (TesteBand).
 */
export const CATALOGO_OFICIAL: ProdutoCatalogoOficial[] = [

  // ── PULSEIRAS DE IDENTIFICAÇÃO ────────────────────────────────────────────

  {
    id_produto: 101,
    nomeComercial: 'Pulseira Triband Sintética',
    categoria: 'pulseira',
    ativo: true,
    aliases: [
      'triband',           // canônico — vence 9001/TesteBand
      'tri band',
      'tri',               // catálogo oficial tem prioridade sobre 9001
      'tyvek',             // sinônimo operacional comum
      'pulseira tri',
      'pulseira triband',
      'tribnd',            // typo
      'tribnda',           // typo
    ],
  },

  {
    id_produto: 102,
    nomeComercial: 'Pulseira ColorBand',
    categoria: 'pulseira',
    ativo: true,
    aliases: [
      'colorband',         // canônico
      'color band',
      'colorida',
      'pulseira colorband',
      'pulseira color',
      'cor band',
    ],
  },

  {
    id_produto: 103,
    nomeComercial: 'Pulseira JetBand',
    categoria: 'pulseira',
    ativo: false,          // INATIVO em public.produtos — não cotar sem aviso
    aliases: [
      'jetband',
      'jet band',
      'jet',
      'jato de tinta',
      'nylon',             // nylon/nilon → JetBand (inativo)
      'nilon',
      'pulseira jato de tinta',
      'pulseira nylon',
      'jetbnd',            // typo
    ],
  },

  {
    id_produto: 104,
    nomeComercial: 'Pulseira Bracelete',
    categoria: 'pulseira',
    ativo: true,
    aliases: [
      'bracelete',
      'pulseira larga',
      'pulseira vip',
      'pulseira bracelete',
    ],
  },

  {
    id_produto: 105,
    nomeComercial: 'Pulseira Botão/Pino',
    categoria: 'pulseira',
    ativo: true,
    aliases: [
      'pulseira botao',
      'pulseira pino',
      'vinil',
      'pulseira vinil',
      'pulseira pvc',
      'pulseira com botao',
      'pulseira com pino',
      'pulseira plastica',
    ],
  },

  {
    id_produto: 106,
    nomeComercial: 'Pulseira Dryband',
    categoria: 'pulseira',
    ativo: true,
    aliases: [
      'dryband',
      'dry band',
      'pulseira seca',
      'pulseira dryband',
    ],
  },

  // ── PULSEIRAS HOSPITALARES ────────────────────────────────────────────────

  {
    id_produto: 201,
    nomeComercial: 'Pulseira Hospitalar Infantil',
    categoria: 'pulseira hospitalar',
    ativo: true,
    aliases: [
      'pulseira hospitalar infantil',
      'pulseira infantil',
      'pulseira hospital crianca',
      'pulseira hospitalar pequena',
    ],
  },

  {
    id_produto: 202,
    nomeComercial: 'Pulseira Hospitalar Adulto',
    categoria: 'pulseira hospitalar',
    ativo: true,
    aliases: [
      'pulseira hospitalar adulto',
      'pulseira adulto',
      'controle de pacientes',
      'pulseira hospital',
    ],
  },

  // ── PULSEIRAS DE TECIDO ───────────────────────────────────────────────────

  {
    id_produto: 301,
    nomeComercial: 'Pulseira TexBand',
    categoria: 'pulseira de tecido',
    ativo: true,
    aliases: [
      'texband',           // canônico
      'tex band',
      'tex',
      'pulseira cetim',
      'pulseira de tecido',
      'pulseira pano',
      'pulseira sublimada',
      'pulseira poliester',
      'pulseira tex',
      'pulseira tecido',
      'tecido',
    ],
  },

  {
    id_produto: 303,
    nomeComercial: 'Pulseira NeonBand',
    categoria: 'pulseira de tecido',
    ativo: true,
    aliases: [
      'neonband',
      'neon band',
      'pulseira neon',
      'tex neon',
      'pulseira fluorescente',
    ],
  },

  {
    id_produto: 304,
    nomeComercial: 'Pulseira TexBand com Verso',
    categoria: 'pulseira de tecido',
    ativo: true,
    aliases: [
      'texband frente e verso',
      'pulseira tex frente e verso',
      'pulseira com verso',
      'pulseira frente verso',
      'texband verso',
    ],
  },

  // ── INGRESSOS ─────────────────────────────────────────────────────────────

  {
    id_produto: 401,
    nomeComercial: 'Ingresso MOBI',
    categoria: 'ingresso',
    ativo: true,
    aliases: [
      'mobi',
      'moby',              // typo aceito
      'mobi f8',
      'ing mobi',
      'ingresso mobi',
      'ingresso moby',
      'ingresso padrao',
      'ingresso simples',
      'ingresso barato',
    ],
  },

  {
    id_produto: 402,
    nomeComercial: 'Ingresso UP BOX',
    categoria: 'ingresso',
    ativo: true,
    aliases: [
      'up box',
      'up',                // alias curto → 402
      'upbox',
      'box',
      'ingresso caixa',
      'super up',
      'f6',
      'ingresso premium',
      'ingresso festa top',
      'ingresso up',
    ],
  },

  {
    id_produto: 403,
    nomeComercial: 'Ingresso Van Gogh',
    categoria: 'ingresso',
    ativo: true,
    aliases: [
      'van gogh',
      'vangogh',
      'vang',
      'ingresso passaporte',
      'f5',
      'ingresso estreito',
      'ingresso picotado',
      'ingresso arte',
    ],
  },

  {
    id_produto: 404,
    nomeComercial: 'Ingresso Mega 4',
    categoria: 'ingresso',
    ativo: true,
    aliases: [
      'mega 4',
      'mega4',
      'mega',
      'f4',
      'ingresso grande',
      'ingresso vip',
      'ingresso a5',
      'ingresso largo',
    ],
  },

  // ── FICHAS E TICKETS ──────────────────────────────────────────────────────

  {
    id_produto: 501,
    nomeComercial: 'Ticket Color',
    categoria: 'ticket',
    ativo: true,
    aliases: [
      'ticket color',
      'ticket',
      'tickets',
      'tiket',
      'ficha',
      'fichinha',
      'vale bar',
      'fichas de bar',
      'ticket bar',
      'vale bebida',
      'ingresso sem picote',
    ],
  },

  // ── CORDÕES CREDENCIAL — JACARÉ ───────────────────────────────────────────
  // NOTA: 'cordao' sozinho está em ALIASES_AMBIGUOS — pede confirmação

  {
    id_produto: 601,
    nomeComercial: 'Cordão Jacaré (com presilha)',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao jacare',
      'jacare',
      'cordao credencial jacare',
      'cordao com jacare',
      'cordao simples',
      'cordao de cracha jacare',
    ],
  },

  {
    id_produto: 602,
    nomeComercial: 'Cordão Jacaré com Trava de Segurança',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao com trava',
      'cordao jacare trava',
      'cordao jacare com trava',
      'cordao trava',
    ],
  },

  {
    id_produto: 603,
    nomeComercial: 'Cordão Jacaré com Engate Rápido',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao jacare engate rapido',
      'cordao engate rapido jacare',
      'cordao facil encaixe',
      'cordao engate rapido',
    ],
  },

  // ── CORDÕES CREDENCIAL — MOSQUETE ─────────────────────────────────────────

  {
    id_produto: 604,
    nomeComercial: 'Cordão Mosquete Metal',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao mosquete metal',
      'cordao mosquete',
      'mosquete metal',
      'cordao cracha metalico',
    ],
  },

  {
    id_produto: 607,
    nomeComercial: 'Cordão Mosquete Plástico',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao mosquete plastico',
      'mosquete plastico',
      'cordao simples plastico',
    ],
  },

  // ── CORDÕES CREDENCIAL — ARGOLA ───────────────────────────────────────────

  {
    id_produto: 613,
    nomeComercial: 'Cordão com Argola',
    categoria: 'cordao',
    ativo: true,
    aliases: [
      'cordao argola',
      'cordao com argola',
      'argola',
      'cordao chaveiro',
      'cordao redondo',
    ],
  },

  // ── CARTÃO / CRACHÁ PVC ───────────────────────────────────────────────────
  // NOTA: 'cracha' e 'pvc' sozinhos estão em ALIASES_AMBIGUOS

  {
    id_produto: 801,
    nomeComercial: 'Cartão/Crachá PVC 0,76mm',
    categoria: 'cartao pvc',
    ativo: true,
    aliases: [
      'cracha pvc',
      'cartao pvc',
      'cartao pvc 076',
      'cartao rigido',
      'cartao grosso',
      'cartao evento',
      'cartao cracha',
    ],
  },

  {
    id_produto: 802,
    nomeComercial: 'Cartão PVC Chip NFC',
    categoria: 'cartao pvc',
    ativo: true,
    aliases: [
      'cartao chip',
      'cartao nfc',
      'pvc com chip',
      'cartao com nfc',
      'cartao rfid',
      'nfc',
      'rfid',
    ],
  },

  {
    id_produto: 803,
    nomeComercial: 'Cartão PVC Slim 0,45mm',
    categoria: 'cartao pvc',
    ativo: true,
    aliases: [
      'cartao slim',
      'cartao fino',
      'cartao pvc fino',
      'cartao leve',
      'cracha fino',
      'pvc 045',
    ],
  },

  // ── CREDENCIAL PVC ────────────────────────────────────────────────────────

  {
    id_produto: 901,
    nomeComercial: 'Credencial PVC',
    categoria: 'credencial',
    ativo: true,
    aliases: [
      'credencial',
      'credenciais',
      'credencial rigida',
      'credencial pvc',
      'cracha pvc credencial',
      'plastico identificacao',
      'credencial para eventos',
    ],
  },

  {
    id_produto: 902,
    nomeComercial: 'Credencial Slim',
    categoria: 'credencial',
    ativo: true,
    aliases: [
      'credencial slim',
      'credencial fina',
      'credencial 045',
      'credencial flexivel',
      'credencial leve',
      'cracha slim',
    ],
  },
];

// ─── Helpers de Normalização ──────────────────────────────────────────────────

/**
 * Normaliza texto para comparação: lowercase, sem acentos, sem pontuação extra.
 */
export function normalizarTermoCatalogo(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')      // pontuação → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Motor de Resolução ───────────────────────────────────────────────────────

export interface ResoluçãoCatalogoResult {
  /** ID resolvido, ou null se não encontrado */
  id_produto: number | null;
  /** Nome comercial do produto */
  nomeComercial?: string;
  /**
   * Dimensão ou tamanho — campo legado, mantido para compatibilidade com presenter.
   * O catálogo novo não popula este campo (vem do banco via snapshot).
   */
  dimensaoComercial?: string;
  /**
   * Prazo de produção — campo legado, mantido para compatibilidade com presenter.
   * O catálogo novo não popula este campo (vem do banco via snapshot).
   */
  prazoProducaoTexto?: string;
  /** Tipo de match encontrado */
  tipoMatch: 'exato' | 'parcial' | 'nao_encontrado' | 'ambiguo' | 'inativo' | 'generico';
  /** Todos os candidatos em caso de ambiguidade */
  candidatos?: ProdutoCatalogoOficial[];
  /** Produto inativo encontrado (para avisar o usuário) */
  produtoInativo?: ProdutoCatalogoOficial;
  /** Sugestão de confirmação para alias genérico */
  sugestaoGenerico?: string;
  /** Opções disponíveis para alias genérico */
  opcoesGenerico?: string[];
}


/**
 * Resolve um termo do usuário para id_produto usando o catálogo oficial.
 *
 * Prioridade:
 *   0. Alias genérico/ambíguo → retorna tipoMatch='generico' (requer confirmação)
 *   1. ID numérico explícito
 *   2. Alias exato no catálogo (ativo vence inativo)
 *   3. Alias parcial seguro (mín. 3 chars)
 *   4. Não encontrado
 *
 * REGRA DE PRODUTO INATIVO:
 *   Se encontrar o produto mas ativo=false, retorna tipoMatch='inativo'.
 *   O engine NUNCA deve cotar produto inativo sem avisar o usuário.
 */
export function resolverTermoCatalogo(termo: string): ResoluçãoCatalogoResult {
  const norm = normalizarTermoCatalogo(termo);

  // ── 0. Alias genérico — requer confirmação ───────────────────────────────
  const genericoCheck = ALIASES_AMBIGUOS[norm];
  if (genericoCheck) {
    return {
      id_produto: null,
      tipoMatch: 'generico',
      sugestaoGenerico: genericoCheck.sugestao,
      opcoesGenerico: genericoCheck.opcoes,
    };
  }

  // ── 1. ID numérico explícito ──────────────────────────────────────────────
  if (/^\d+$/.test(norm)) {
    const id = parseInt(norm, 10);
    const produto = CATALOGO_OFICIAL.find(p => p.id_produto === id);
    if (produto) {
      if (produto.ativo === false) {
        return { id_produto: produto.id_produto, nomeComercial: produto.nomeComercial, tipoMatch: 'inativo', produtoInativo: produto };
      }
      return { id_produto: produto.id_produto, nomeComercial: produto.nomeComercial, tipoMatch: 'exato' };
    }
    return { id_produto: id, nomeComercial: undefined, tipoMatch: 'exato' };
  }

  // ── 2. Alias exato ───────────────────────────────────────────────────────
  const exatos = CATALOGO_OFICIAL.filter(p =>
    p.aliases.some(a => normalizarTermoCatalogo(a) === norm)
  );

  if (exatos.length === 1) {
    const p = exatos[0];
    if (p.ativo === false) {
      return { id_produto: p.id_produto, nomeComercial: p.nomeComercial, tipoMatch: 'inativo', produtoInativo: p };
    }
    return { id_produto: p.id_produto, nomeComercial: p.nomeComercial, tipoMatch: 'exato' };
  }
  if (exatos.length > 1) {
    const ativos = exatos.filter(p => p.ativo !== false);
    if (ativos.length === 1) {
      return { id_produto: ativos[0].id_produto, nomeComercial: ativos[0].nomeComercial, tipoMatch: 'exato' };
    }
    return { id_produto: null, tipoMatch: 'ambiguo', candidatos: exatos };
  }

  // ── 3. Alias parcial seguro (mín. 3 chars) ───────────────────────────────
  const parciaisSeguros = CATALOGO_OFICIAL.filter(p =>
    p.aliases.some(a => {
      const normAlias = normalizarTermoCatalogo(a);
      return (normAlias.includes(norm) || norm.includes(normAlias))
        && normAlias.length >= 3
        && norm.length >= 3;
    })
  );

  if (parciaisSeguros.length === 1) {
    const p = parciaisSeguros[0];
    if (p.ativo === false) {
      return { id_produto: p.id_produto, nomeComercial: p.nomeComercial, tipoMatch: 'inativo', produtoInativo: p };
    }
    return { id_produto: p.id_produto, nomeComercial: p.nomeComercial, tipoMatch: 'parcial' };
  }
  if (parciaisSeguros.length > 1) {
    const ativos = parciaisSeguros.filter(p => p.ativo !== false);
    if (ativos.length === 1) {
      return { id_produto: ativos[0].id_produto, nomeComercial: ativos[0].nomeComercial, tipoMatch: 'parcial' };
    }
    return { id_produto: null, tipoMatch: 'ambiguo', candidatos: parciaisSeguros };
  }

  return { id_produto: null, tipoMatch: 'nao_encontrado' };
}

/**
 * Verifica se há conflitos de alias entre produtos do catálogo.
 * Retorna lista de aliases duplicados. Deve retornar [] em produção saudável.
 */
export function verificarConflitosAlias(): Array<{ alias: string; produtos: number[] }> {
  const map = new Map<string, number[]>();
  for (const produto of CATALOGO_OFICIAL) {
    for (const alias of produto.aliases) {
      const norm = normalizarTermoCatalogo(alias);
      if (!map.has(norm)) map.set(norm, []);
      map.get(norm)!.push(produto.id_produto);
    }
  }
  const conflitos: Array<{ alias: string; produtos: number[] }> = [];
  for (const [alias, ids] of map.entries()) {
    if (ids.length > 1) conflitos.push({ alias, produtos: ids });
  }
  return conflitos;
}
