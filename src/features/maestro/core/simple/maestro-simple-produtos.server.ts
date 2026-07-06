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
        .select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo')
        .eq('id_produto', parsedId)
        .limit(1);
      console.log(`[MaestroProductsServer] Busca por ID ${parsedId} -> data:`, resId.data, "error:", resId.error);
      if (resId.data && resId.data.length > 0) {
        data = resId.data as OrcamentoAvulsoProdutoDb[];
      }
    }

    // Fallback: busca textual normal se não encontrou por ID
    if (data.length === 0) {
      const [resApelido, resDesc] = await Promise.all([
        supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo').ilike('apelidos', `%${termoOriginal}%`),
        supabase.from('produtos').select('id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo').ilike('descricao', `%${termoOriginal}%`)
      ]);

      const map = new Map<number, OrcamentoAvulsoProdutoDb>();
      if (resApelido.data) {
        for (const p of resApelido.data as OrcamentoAvulsoProdutoDb[]) map.set(p.id_produto, p);
      }
      if (resDesc.data) {
        for (const p of resDesc.data as OrcamentoAvulsoProdutoDb[]) map.set(p.id_produto, p);
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
