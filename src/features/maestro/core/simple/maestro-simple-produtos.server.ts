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
    .select('id_produto, "nomeReal", descricao, apelidos, categoria, ativo, "valorUnt", "valorFixo", quantidade_minima_venda');

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

    const termoNorm = normalizeText(termoOriginal);

    let data: OrcamentoAvulsoProdutoDb[] = [];

    // Prioridade 1: Se for um ID numérico explícito ou implícito
    const isIdMatch = termoOriginal.match(/^(\d+)$/) || termoOriginal.match(/\b(?:id\s*do\s*produto|id\s*produto|id|prod)?\s*(\d+)\b/i);
    const parsedId = isIdMatch ? parseInt(isIdMatch[1], 10) : NaN;

    if (!isNaN(parsedId)) {
      const resId = await supabase.from('produtos')
        .select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso')
        .eq('id_produto', parsedId)
        .limit(1);
      console.log(`[MaestroProductsServer] Busca por ID ${parsedId} -> data:`, resId.data, "error:", resId.error);
      if (resId.data && resId.data.length > 0) {
        // Mapeando a resposta para lidar com snake_case vs camelCase
        data = resId.data.map(p => ({ ...p, pesoUnitario: p.peso })) as OrcamentoAvulsoProdutoDb[];
      }
    }

    // Fallback: busca textual normal se não encontrou por ID
    if (data.length === 0) {
      const [resApelido, resDesc] = await Promise.all([
        supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso').ilike('apelidos', `%${termoOriginal}%`),
        supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso').ilike('descricao', `%${termoOriginal}%`)
      ]);

      const map = new Map<number, OrcamentoAvulsoProdutoDb>();
      if (resApelido.data) {
        for (const p of resApelido.data) map.set(p.id_produto, { ...p, pesoUnitario: p.peso } as OrcamentoAvulsoProdutoDb);
      }
      if (resDesc.data) {
        for (const p of resDesc.data) map.set(p.id_produto, { ...p, pesoUnitario: p.peso } as OrcamentoAvulsoProdutoDb);
      }
      data = Array.from(map.values());
    }
    let rankedProducts: OrcamentoAvulsoProdutoDb[] = [];

    if (data.length > 0) {
      if (!isNaN(parsedId)) {
        // Encontrado por ID direto - não faz filtragem textual
        rankedProducts = data;
      } else {
        // 1. Match exato em apelidos
        const exactAliasMatch = data.filter(p => {
          const apList = getApelidosList(p.apelidos);
          return apList.includes(termoNorm);
        });

        if (exactAliasMatch.length > 0) {
          rankedProducts = exactAliasMatch;
        } else {
          // 2. Match parcial em apelidos
          const partialAliasMatch = data.filter(p => {
          const apList = getApelidosList(p.apelidos);
          return apList.some(ap => ap.includes(termoNorm));
        });
        
        if (partialAliasMatch.length > 0) {
          rankedProducts = partialAliasMatch;
        } else {
          // 3. Match em descricao
          const descMatch = data.filter(p => {
            const desc = normalizeText(p.descricao);
            return desc.includes(termoNorm);
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
