import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrcamentoAvulsoItemReq {
  quantidade: number;
  termo: string;
}

export interface OrcamentoAvulsoProdutoDb {
  id_produto: number;
  descricao: string;
  apelidos: string | null;
  valorUnt: number | null;
  valorFixo: number | null;
  pesoUnitario?: number | null;
  /** Dimensões cadastradas (ex.: "25×2cm") */
  formato?: string | null;
  /** Prazo de produção cadastrado (texto) */
  prazo?: string | null;
  /** Nome comercial do produto (produtos."nomeReal") */
  nomeReal?: string | null;
  ativo: boolean;
}

export interface OrcamentoAvulsoMatch {
  termo: string;
  quantidade: number;
  produtosEncontrados: OrcamentoAvulsoProdutoDb[];
  subtotalCalculado: number | null; // null se houver ambiguidade, produto inativo ou preço incompleto
  status: 'sucesso' | 'inativo' | 'ambiguo' | 'nao_encontrado' | 'preco_incompleto';
}

export interface OrcamentoAvulsoResult {
  itens: OrcamentoAvulsoMatch[];
  totalGeral: number | null; // null se houver qualquer item não "sucesso"
}

function normalizeText(text: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getApelidosList(apelidosStr: string | null): string[] {
  if (!apelidosStr) return [];
  const parts = apelidosStr.split(/[,;\n\[\]]/);
  return parts.map(p => normalizeText(p)).filter(p => p.length > 0);
}

// ─── Listagem do catálogo (visão ampla por família/termo) ───────────────────

export interface ProdutoCatalogoItem {
  id_produto: number;
  nome: string;
  categoria: string | null;
  ativo: boolean;
  valorUnt: number | null;
  valorFixo: number | null;
  quantidade_minima_venda: number | null;
  apelidos: string | null;
  /** Dimensões do produto (ex.: "25×2cm") */
  formato: string | null;
  /** Peso unitário em gramas */
  peso_unitario_gramas: number | null;
  /** Prazo de produção cadastrado (texto, ex.: "2 dias úteis") */
  prazo_producao: string | null;
  /** Descrição oficial cadastrada — única fonte para "para que serve" */
  descricao: string | null;
  /** Nível de segurança cadastrado (produtos."nivelSeg", ex.: "Médio / Alto") */
  nivel_seguranca: string | null;
  /** Opções de personalização/impressão cadastradas */
  personalizacao: string | null;
  /** Frase comercial do consultor (produtos."fraseCons") */
  frase_consultor: string | null;
}

export interface ListagemProdutosResult {
  found: boolean;
  total: number;
  itens: ProdutoCatalogoItem[];
  /** Contagem por categoria (calculada no servidor) */
  por_categoria: Record<string, number>;
  termo?: string;
  truncado: boolean;
  source: string;
  error?: string;
}

const LISTAGEM_PRODUTOS_MAX = 100;

/**
 * Lista produtos do catálogo por termo AMPLO (nome, descrição, apelidos e
 * categoria via ilike parcial) ou o catálogo inteiro quando sem termo.
 * Complementa a busca pontual (match exato de apelido) usada nas cotações.
 */
export async function listarProdutosCatalogo(
  supabase: SupabaseClient,
  opts?: { termo?: string; incluirInativos?: boolean },
): Promise<ListagemProdutosResult> {
  // PostgREST usa vírgula/parênteses como sintaxe do .or() — remove do termo
  const termo = (opts?.termo ?? '').trim().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim();

  let query = supabase
    .from('produtos')
    .select('id_produto, "nomeReal", descricao, apelidos, categoria, ativo, "valorUnt", "valorFixo", quantidade_minima_venda, formato, peso, prazo, "nivelSeg", personalizacao, "fraseCons"');

  if (!opts?.incluirInativos) query = query.eq('ativo', true);
  if (termo) {
    const t = `%${termo}%`;
    query = query.or(`nomeReal.ilike.${t},descricao.ilike.${t},apelidos.ilike.${t},categoria.ilike.${t}`);
  }

  const { data, error } = await query
    .order('categoria', { ascending: true })
    .order('nomeReal', { ascending: true })
    .limit(LISTAGEM_PRODUTOS_MAX);

  if (error) {
    return { found: false, total: 0, itens: [], por_categoria: {}, termo: termo || undefined, truncado: false, source: 'public.produtos', error: error.message };
  }

  const porCategoria: Record<string, number> = {};
  const itens: ProdutoCatalogoItem[] = (data ?? []).map(raw => {
    const r = raw as Record<string, unknown>;
    const categoria = typeof r.categoria === 'string' && r.categoria.trim() ? r.categoria.trim() : null;
    porCategoria[categoria ?? 'SEM_CATEGORIA'] = (porCategoria[categoria ?? 'SEM_CATEGORIA'] ?? 0) + 1;
    return {
      id_produto: Number(r.id_produto),
      nome: (typeof r.nomeReal === 'string' && r.nomeReal.trim()) ? r.nomeReal.trim()
          : (typeof r.descricao === 'string' ? r.descricao.trim() : `Produto ${r.id_produto}`),
      categoria,
      ativo: r.ativo === true,
      valorUnt: r.valorUnt != null ? Number(r.valorUnt) : null,
      valorFixo: r.valorFixo != null ? Number(r.valorFixo) : null,
      quantidade_minima_venda: r.quantidade_minima_venda != null ? Number(r.quantidade_minima_venda) : null,
      apelidos: typeof r.apelidos === 'string' && r.apelidos.trim() ? r.apelidos.trim() : null,
      formato: typeof r.formato === 'string' && r.formato.trim() ? r.formato.trim() : null,
      peso_unitario_gramas: r.peso != null && Number.isFinite(Number(r.peso)) ? Number(r.peso) : null,
      prazo_producao: typeof r.prazo === 'string' && r.prazo.trim() ? r.prazo.trim() : null,
      descricao: typeof r.descricao === 'string' && r.descricao.trim() ? r.descricao.trim().slice(0, 300) : null,
      nivel_seguranca: typeof r.nivelSeg === 'string' && r.nivelSeg.trim() ? r.nivelSeg.trim() : null,
      personalizacao: typeof r.personalizacao === 'string' && r.personalizacao.trim() ? r.personalizacao.trim().slice(0, 300) : null,
      frase_consultor: typeof r.fraseCons === 'string' && r.fraseCons.trim() ? r.fraseCons.trim().slice(0, 300) : null,
    };
  });

  return {
    found: itens.length > 0,
    total: itens.length,
    itens,
    por_categoria: porCategoria,
    termo: termo || undefined,
    truncado: itens.length >= LISTAGEM_PRODUTOS_MAX,
    source: 'public.produtos',
  };
}

// ─── Fotos do catálogo (public.view_fotos_por_produtos) ─────────────────────

export interface FotosProdutoGrupo {
  nome_produto: string;
  fotos: string[];
}

export interface FotosProdutoResult {
  found: boolean;
  produtos: FotosProdutoGrupo[];
  /** Presente quando found=false — a resposta deve usar EXATAMENTE esta formulação */
  mensagem_sem_fotos?: string;
  termo: string;
  source: string;
  error?: string;
}

const FOTOS_MAX_PRODUTOS = 3;
const FOTOS_MAX_POR_PRODUTO = 4;
export const MENSAGEM_SEM_FOTOS =
  'Os administradores ainda não salvaram as fotos deste produto no catálogo.';

/**
 * Fotos oficiais de um produto. A view vincula por NOME (texto livre, com
 * inconsistências de espaços), então o match é por nome normalizado: igualdade
 * exata tem prioridade; sem igualdade, valem os matches parciais (ilike).
 * Sem foto NÃO é erro: found=false + mensagem oficial dos administradores.
 */
export async function buscarFotosProduto(
  supabase: SupabaseClient,
  nomeProduto: string,
): Promise<FotosProdutoResult> {
  const termo = (nomeProduto ?? '').trim().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim();
  const base: FotosProdutoResult = {
    found: false,
    produtos: [],
    termo,
    source: 'public.view_fotos_por_produtos',
  };
  if (!termo) return { ...base, error: 'termo_vazio', mensagem_sem_fotos: MENSAGEM_SEM_FOTOS };

  const { data, error } = await supabase
    .from('view_fotos_por_produtos')
    .select('nome_produto, imagens_url')
    .ilike('nome_produto', `%${termo}%`)
    .limit(60);
  if (error) return { ...base, error: error.message, mensagem_sem_fotos: MENSAGEM_SEM_FOTOS };

  const termoNorm = normalizeText(termo);
  const grupos = new Map<string, { nome: string; fotos: Set<string>; exato: boolean }>();
  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    const nome = typeof r.nome_produto === 'string' ? r.nome_produto.trim() : '';
    const url = typeof r.imagens_url === 'string' ? r.imagens_url.trim() : '';
    if (!nome || !url.startsWith('https://')) continue;
    const chave = normalizeText(nome);
    const grupo = grupos.get(chave) ?? { nome, fotos: new Set<string>(), exato: chave === termoNorm };
    grupo.fotos.add(url);
    grupos.set(chave, grupo);
  }

  let lista = Array.from(grupos.values());
  if (lista.some(g => g.exato)) lista = lista.filter(g => g.exato);
  const produtos = lista.slice(0, FOTOS_MAX_PRODUTOS).map(g => ({
    nome_produto: g.nome,
    fotos: Array.from(g.fotos).slice(0, FOTOS_MAX_POR_PRODUTO),
  }));

  if (produtos.length === 0) return { ...base, mensagem_sem_fotos: MENSAGEM_SEM_FOTOS };
  return { ...base, found: true, produtos };
}

/** Singular ingênuo por palavra ("tribands"→"triband", "ingressos mobi"→"ingresso mobi"). */
function singularizarTermo(termo: string): string {
  return termo
    .split(/\s+/)
    .map(p => (p.length >= 4 && /s$/i.test(p) && !/ss$/i.test(p) ? p.slice(0, -1) : p))
    .join(' ');
}

/** Busca textual em apelidos, descrição e nome comercial (dedup por id). */
async function buscarProdutosTextual(
  supabase: SupabaseClient,
  termo: string,
): Promise<OrcamentoAvulsoProdutoDb[]> {
  const [resApelido, resDesc, resNome] = await Promise.all([
    supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso, formato, prazo, "nomeReal"').ilike('apelidos', `%${termo}%`),
    supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso, formato, prazo, "nomeReal"').ilike('descricao', `%${termo}%`),
    supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso, formato, prazo, "nomeReal"').ilike('nomeReal', `%${termo}%`),
  ]);

  const map = new Map<number, OrcamentoAvulsoProdutoDb>();
  if (resApelido.data) {
    for (const p of resApelido.data) map.set(p.id_produto, { ...p, pesoUnitario: p.peso } as OrcamentoAvulsoProdutoDb);
  }
  if (resDesc.data) {
    for (const p of resDesc.data) map.set(p.id_produto, { ...p, pesoUnitario: p.peso } as OrcamentoAvulsoProdutoDb);
  }
  if (resNome.data) {
    for (const p of resNome.data) map.set(p.id_produto, { ...p, pesoUnitario: p.peso } as OrcamentoAvulsoProdutoDb);
  }
  return Array.from(map.values());
}

export async function simularOrcamentoAvulsoDb(
  supabase: SupabaseClient,
  itensReq: OrcamentoAvulsoItemReq[]
): Promise<OrcamentoAvulsoResult> {
  const result: OrcamentoAvulsoResult = {
    itens: [],
    totalGeral: 0,
  };

  let allSuccess = true;

  for (const req of itensReq) {
    const termoOriginal = req.termo.trim();
    if (!termoOriginal) continue;

    let data: OrcamentoAvulsoProdutoDb[] = [];

    // Prioridade 1: Se for um ID numérico explícito ou implícito
    const isIdMatch = termoOriginal.match(/^(\d+)$/) || termoOriginal.match(/\b(?:id\s*do\s*produto|id\s*produto|id|prod)?\s*(\d+)\b/i);
    const parsedId = isIdMatch ? parseInt(isIdMatch[1], 10) : NaN;

    if (!isNaN(parsedId)) {
      const resId = await supabase.from('produtos')
        .select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso, formato, prazo, "nomeReal"')
        .eq('id_produto', parsedId)
        .limit(1);
      console.log(`[MaestroProductsServer] Busca por ID ${parsedId} -> data:`, resId.data, "error:", resId.error);
      if (resId.data && resId.data.length > 0) {
        // Mapeando a resposta para lidar com snake_case vs camelCase
        data = resId.data.map(p => ({ ...p, pesoUnitario: p.peso })) as OrcamentoAvulsoProdutoDb[];
      }
    }

    // Fallback: busca textual normal se não encontrou por ID (apelidos,
    // descrição e nome comercial — "Ingresso MOBI" precisa achar por nomeReal)
    let termoBusca = termoOriginal;
    if (data.length === 0) {
      data = await buscarProdutosTextual(supabase, termoOriginal);
      // Plural não cadastrado ("tribands") → tenta o singular ("triband").
      // Sem isso a simulação falha e o modelo cai em tools que entregam preço
      // cru sem subtotal — origem do orçamento sem o valor fixo (04/08).
      if (data.length === 0) {
        const singular = singularizarTermo(termoOriginal);
        if (singular !== termoOriginal) {
          data = await buscarProdutosTextual(supabase, singular);
          if (data.length > 0) termoBusca = singular;
        }
      }
    }
    const termoNorm = normalizeText(termoBusca);
    let rankedProducts: OrcamentoAvulsoProdutoDb[] = [];

    if (data.length > 0) {
      if (!isNaN(parsedId)) {
        // Encontrado por ID direto - não faz filtragem textual
        rankedProducts = data;
      } else {
        // 1. Match exato: nome comercial (nomeReal) ou apelido
        const exactMatch = data.filter(p => {
          if (normalizeText(p.nomeReal ?? null) === termoNorm) return true;
          const apList = getApelidosList(p.apelidos);
          return apList.includes(termoNorm);
        });

        if (exactMatch.length > 0) {
          rankedProducts = exactMatch;
        } else {
          // 2. Match parcial em apelidos
          const partialAliasMatch = data.filter(p => {
          const apList = getApelidosList(p.apelidos);
          return apList.some(ap => ap.includes(termoNorm));
        });

        if (partialAliasMatch.length > 0) {
          rankedProducts = partialAliasMatch;
        } else {
          // 3. Match em nome comercial ou descricao
          const descMatch = data.filter(p => {
            const desc = normalizeText(p.descricao);
            const nome = normalizeText(p.nomeReal ?? null);
            return desc.includes(termoNorm) || nome.includes(termoNorm);
          });
          rankedProducts = descMatch;
        }
      }
    }
  }

    const match: OrcamentoAvulsoMatch = {
      termo: termoOriginal,
      quantidade: req.quantidade,
      produtosEncontrados: rankedProducts,
      subtotalCalculado: null,
      status: 'nao_encontrado',
    };

    if (rankedProducts.length === 0) {
      match.status = 'nao_encontrado';
      allSuccess = false;
    } else if (rankedProducts.length > 1) {
      match.status = 'ambiguo';
      allSuccess = false;
    } else {
      const p = rankedProducts[0];
      if (!p.ativo) {
        match.status = 'inativo';
        allSuccess = false;
      } else if (p.valorUnt == null) {
        match.status = 'preco_incompleto';
        allSuccess = false;
      } else {
        match.status = 'sucesso';
        const vFixo = p.valorFixo ?? 0;
        match.subtotalCalculado = (req.quantidade * p.valorUnt) + vFixo;
        if (result.totalGeral !== null) {
          result.totalGeral += match.subtotalCalculado;
        }
      }
    }

    result.itens.push(match);
  }

  if (!allSuccess) {
    result.totalGeral = null;
  }

  return result;
}
