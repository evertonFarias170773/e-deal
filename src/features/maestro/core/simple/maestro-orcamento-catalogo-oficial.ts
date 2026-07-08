/**
 * maestro-orcamento-catalogo-oficial.ts
 *
 * Catálogo oficial de produtos operacionais da Ingresso Ideal.
 *
 * RESPONSABILIDADE:
 *   Mapear termos digitados pelo usuário para id_produto oficial.
 *   NÃO é fonte de preço, não é fonte de valorUnt/valorFixo/ativo.
 *   Preço e status SEMPRE vêm de public.produtos (banco real).
 *
 * REGRA DE RESOLUÇÃO:
 *   1. ID explícito do produto informado pelo usuário
 *   2. Alias exato no catálogo oficial (esta lista)
 *   3. Alias parcial seguro neste catálogo
 *   4. public.produtos.apelidos (banco)
 *   5. public.produtos.descricao como fallback (banco)
 *
 * Normalização: lowercase, sem acentos, sem pontuação.
 *   Ex: "Triband" → "triband", "Cordão Jacaré" → "cordao jacare"
 *
 * Everton: lista operacional base fornecida em 2026-07-07.
 * Atualizar esta lista apenas quando produto muda de ID ou nome comercial.
 * Preço nunca vem daqui.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProdutoCatalogoOficial {
  /** ID real em public.produtos */
  id_produto: number;
  /** Nome comercial oficial */
  nomeComercial: string;
  /** Categoria comercial */
  categoria: string;
  /**
   * Aliases aceitos — todos em lowercase sem acento.
   * O primeiro alias é o canônico (preferido em mensagens).
   */
  aliases: string[];
  /** Dimensão ou característica extra apresentada na interface comercial (novo padrão) */
  dimensaoComercial?: string;
  /** Texto informando o prazo de produção médio */
  prazoProducaoTexto?: string;
}

// ─── Catálogo Operacional ─────────────────────────────────────────────────────

/**
 * Lista oficial de produtos com aliases.
 * Cada alias mapeia para um único id_produto.
 * Conflicts (mesmo alias em dois produtos) causam ambiguidade e devem ser evitados.
 */
export const CATALOGO_OFICIAL: ProdutoCatalogoOficial[] = [
  // ── INGRESSOS ──────────────────────────────────────────────────────────────

  {
    id_produto: 401,
    nomeComercial: 'Ingresso MOBI (Papel BOPP/Couchê com picote)',
    categoria: 'ingresso',
    aliases: ['mobi', 'moby', 'ingresso mobi', 'ingresso moby', 'papel mobi'],
    dimensaoComercial: '10×5cm', // exemplo genérico
    prazoProducaoTexto: '3 dias úteis',
  },

  {
    id_produto: 402,
    nomeComercial: 'Ingresso UP (Papel Couchê com picote)',
    categoria: 'ingresso',
    aliases: ['up', 'ingresso up', 'papel up', 'cali', 'california'],
    dimensaoComercial: '10×5cm',
    prazoProducaoTexto: '3 dias úteis',
  },

  {
    id_produto: 501,
    nomeComercial: 'Ticket (Papel Couchê sem picote)',
    categoria: 'ticket',
    aliases: ['ticket', 'tickets', 'ingresso sem picote', 'papel sem picote', 'tike', 'tiket'],
    dimensaoComercial: '10×5cm',
    prazoProducaoTexto: '3 dias úteis',
  },

  // ── PULSEIRAS ─────────────────────────────────────────────────────────────

  {
    id_produto: 101,
    nomeComercial: 'Pulseira Triband Sintética',
    categoria: 'pulseira',
    aliases: [
      'triband',         // canônico
      'tri band',
      'tri',             // alias curto — resolve para 101 (produto de teste #9001 não deve vencer)
      'tyvek',           // sinônimo operacional comum
      'pulseira tri', 'pulseira triband',
    ],
    dimensaoComercial: '25×2cm',
    prazoProducaoTexto: '1 dia útil',
  },

  {
    id_produto: 102,
    nomeComercial: 'Pulseira de Tecido (Velcro)',
    categoria: 'pulseira',
    aliases: ['tecido', 'pulseira tecido', 'velcro', 'pulseira velcro', 'fabric', 'texband'],
    dimensaoComercial: '35×2cm',
    prazoProducaoTexto: '3 dias úteis',
  },

  {
    id_produto: 103,
    nomeComercial: 'Pulseira de Silicone',
    categoria: 'pulseira',
    aliases: ['silicone', 'pulseira silicone', 'borracha'],
    dimensaoComercial: 'Padrão',
    prazoProducaoTexto: '3 dias úteis',
  },

  // ── CORDÕES ───────────────────────────────────────────────────────────────

  {
    id_produto: 601,
    nomeComercial: 'Cordão Jacaré (com presilha)',
    categoria: 'cordao',
    aliases: [
      'cordao jacare',   // canônico normalizado
      'jacare',
      'cordao',          // generico — resolvido para jacaré (produto principal)
      'cordon jacare', 'cordao com jacare',
    ],
    dimensaoComercial: '85×2cm',
    prazoProducaoTexto: '3 dias úteis',
  },

  {
    id_produto: 602,
    nomeComercial: 'Cordão com Argola Giratória',
    categoria: 'cordao',
    aliases: ['cordao argola', 'argola'],
    dimensaoComercial: '85×2cm',
    prazoProducaoTexto: '3 dias úteis',
  },

  // ── CRACHÁS / CREDENCIAIS ─────────────────────────────────────────────────

  {
    id_produto: 701,
    nomeComercial: 'Crachá PVC (Cartão plástico rígido)',
    categoria: 'cracha',
    aliases: ['cracha pvc', 'cartao pvc', 'pvc', 'cracha rigido'],
  },

  {
    id_produto: 702,
    nomeComercial: 'Crachá Papel (Credencial impressa)',
    categoria: 'cracha',
    aliases: ['cracha papel', 'credencial', 'credencial papel', 'cracha impresso'],
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
  /** Dimensão ou tamanho */
  dimensaoComercial?: string;
  /** Prazo de produção descritivo */
  prazoProducaoTexto?: string;
  /** Tipo de match encontrado */
  tipoMatch: 'exato' | 'parcial' | 'nao_encontrado' | 'ambiguo';
  /** Todos os candidatos em caso de ambiguidade */
  candidatos?: ProdutoCatalogoOficial[];
}

/**
 * Resolve um termo do usuário para id_produto usando o catálogo oficial.
 * Prioridade: alias exato → alias parcial → ambiguidade → não encontrado.
 *
 * NÃO consulta o banco. O banco é consultado após a resolução pelo Resolver.
 */
export function resolverTermoCatalogo(termo: string): ResoluçãoCatalogoResult {
  const norm = normalizarTermoCatalogo(termo);

  // Tenta ID numérico explícito primeiro
  if (/^\d+$/.test(norm)) {
    const id = parseInt(norm, 10);
    const produto = CATALOGO_OFICIAL.find(p => p.id_produto === id);
    if (produto) {
      return { id_produto: produto.id_produto, nomeComercial: produto.nomeComercial, tipoMatch: 'exato' };
    }
    // ID numérico mas não no catálogo — cai no banco via resolver
    return { id_produto: id, nomeComercial: undefined, tipoMatch: 'exato' };
  }

  // ── Alias exato ─────────────────────────────────────────────────────────────
  const exatos = CATALOGO_OFICIAL.filter(p =>
    p.aliases.some(a => normalizarTermoCatalogo(a) === norm)
  );

  if (exatos.length === 1) {
    return { id_produto: exatos[0].id_produto, nomeComercial: exatos[0].nomeComercial, tipoMatch: 'exato' };
  }
  if (exatos.length > 1) {
    return { id_produto: null, tipoMatch: 'ambiguo', candidatos: exatos };
  }

  // ── Alias parcial (termo contido no alias ou alias contido no termo) ─────────
  const parciais = CATALOGO_OFICIAL.filter(p =>
    p.aliases.some(a => {
      const normAlias = normalizarTermoCatalogo(a);
      return normAlias.includes(norm) || norm.includes(normAlias);
    })
  );

  // Filtro de segurança: aliases parciais muito curtos (≤2 chars) não são aceitos
  const parciaisSeguros = parciais.filter(p =>
    p.aliases.some(a => {
      const normAlias = normalizarTermoCatalogo(a);
      return (normAlias.includes(norm) || norm.includes(normAlias)) && normAlias.length > 2 && norm.length > 2;
    })
  );

  if (parciaisSeguros.length === 1) {
    return { id_produto: parciaisSeguros[0].id_produto, nomeComercial: parciaisSeguros[0].nomeComercial, tipoMatch: 'parcial' };
  }
  if (parciaisSeguros.length > 1) {
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
