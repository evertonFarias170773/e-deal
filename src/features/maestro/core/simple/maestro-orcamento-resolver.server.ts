/**
 * maestro-orcamento-resolver.server.ts
 *
 * Resolvedor de catálogo de produtos para o Orçamento Avulso.
 * Consulta public.produtos em modo estritamente READ-ONLY.
 *
 * Regras de negócio:
 *   - subtotal = quantidade * valorUnt + valorFixo
 *   - se valorUnt for null, status = 'preco_incompleto' (cálculo bloqueado)
 *   - se valorFixo for null, trata como 0 (regra documentada)
 *   - produto com ativo=false → status = 'inativo' (não entra no total)
 *   - múltiplos produtos encontrados → status = 'ambiguo'
 *   - nenhum produto encontrado → status = 'nao_encontrado'
 *
 * Prioridade de busca:
 *   1. ID numérico explícito (ex: "101", "id:101", "id do produto 101")
 *   2. Apelido exato
 *   3. Apelido parcial (contém o termo)
 *   4. Descrição como fallback
 *
 * IMPORTANTE:
 *   - Não altera nenhum dado no banco.
 *   - Não acessa tabelas de clientes, financeiro ou produção.
 *   - Não usa Brain/OpenAI.
 *   - MAESTRO_AVULSO_ENABLED=false é verificado FORA deste módulo (no Router/Engine).
 *   - Este módulo é injetável para facilitar testes (supabase é passado como parâmetro).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';

// ─── Tipos Exportados ─────────────────────────────────────────────────────────

/** Linha da tabela public.produtos que o resolvedor lê */
export interface ProdutoDb {
  id_produto: number;
  descricao: string;
  apelidos: string | null;
  valorUnt: number | null;
  valorFixo: number | null;
  peso?: number | null;
  ativo: boolean;
}

/** Um item de entrada para o resolvedor */
export interface ResolverItemReq {
  quantidade: number;
  /** Termo de busca: pode ser texto livre, ID numérico, "id:101", etc. */
  termo: string;
}

/** Status possíveis para cada item resolvido */
export type ResolverItemStatus =
  | 'sucesso'
  | 'nao_encontrado'
  | 'ambiguo'
  | 'inativo'
  | 'preco_incompleto';

/** Resultado de um único item resolvido */
export interface ResolverItemResult {
  termo: string;
  quantidade: number;
  status: ResolverItemStatus;
  /** Produto único encontrado (quando status = sucesso | inativo | preco_incompleto) */
  produto?: ProdutoDb;
  /** Múltiplos candidatos (quando status = ambiguo) */
  candidatos?: ProdutoDb[];
  /**
   * Subtotal calculado: quantidade * valorUnt + valorFixo
   * null quando o cálculo não foi possível (ambiguo, nao_encontrado, inativo, preco_incompleto)
   */
  subtotal: number | null;
}

/** Resultado agregado de uma resolução de múltiplos itens */
export interface ResolverResult {
  itens: ResolverItemResult[];
  /**
   * Total geral somado de todos os itens com status = 'sucesso'.
   * null se qualquer item não for sucesso.
   */
  totalGeral: number | null;
}

// ─── Utilitários internos ──────────────────────────────────────────────────────

function normalizarTexto(text: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsearApelidos(apelidosStr: string | null): string[] {
  if (!apelidosStr) return [];
  return apelidosStr
    .split(/[,;\n[\]]/)
    .map(p => normalizarTexto(p))
    .filter(p => p.length > 0);
}

/**
 * Extrai ID numérico de um termo, caso exista.
 * Reconhece: "101", "id:101", "id 101", "id do produto 101", "prod 101"
 */
function extrairIdNumerica(termo: string): number | null {
  const m1 = termo.match(/^(\d+)$/);
  if (m1) return parseInt(m1[1], 10);

  const m2 = termo.match(/^id[:\s]*(\d+)$/i);
  if (m2) return parseInt(m2[1], 10);

  const m3 = termo.match(/\b(?:id\s*do\s*produto|id\s*produto|id|prod)\s+(\d+)\b/i);
  if (m3) return parseInt(m3[1], 10);

  return null;
}

const SELECT_COLS = 'id_produto, descricao, apelidos, "valorUnt", "valorFixo", ativo, peso';

// ─── Função principal ──────────────────────────────────────────────────────────

/**
 * Resolve uma lista de itens de orçamento contra o catálogo de produtos real.
 * Consulta public.produtos em modo estritamente read-only.
 *
 * @param supabase - cliente Supabase autenticado (passado por injeção)
 * @param itens    - lista de itens com quantidade e termo de busca
 * @returns ResolverResult com cada item resolvido e total geral
 */
export async function resolverOrcamento(
  supabase: SupabaseClient,
  itens: ResolverItemReq[]
): Promise<ResolverResult> {
  const resultItens: ResolverItemResult[] = [];
  let totalGeral: number | null = 0;
  let todosSuccesso = true;

  for (const req of itens) {
    const termoOriginal = req.termo.trim();
    if (!termoOriginal) continue;

    const termoNorm = normalizarTexto(termoOriginal);
    const idExplicito = extrairIdNumerica(termoOriginal);

    let candidatos: ProdutoDb[] = [];

    // ── Prioridade 1: Busca por ID numérico explícito ─────────────────────────────
    if (idExplicito !== null) {
      const { data, error } = await supabase
        .from('produtos')
        .select(SELECT_COLS)
        .eq('id_produto', idExplicito)
        .limit(1);

      if (error) {
        console.error('[OrcamentoResolver] Erro na busca por ID:', error.message);
      } else if (data && data.length > 0) {
        candidatos = data.map((p: any) => ({ ...p, pesoUnitario: p.peso })) as ProdutoDb[];
      }
    }

    // ── Prioridade 2: Catálogo oficial de aliases (antes de busca textual no banco) ──
    // Resolve o termo para um ID oficial sem ambiguidade de produtos de teste.
    if (candidatos.length === 0) {
      const resolvido = resolverTermoCatalogo(termoOriginal);

      if (resolvido.tipoMatch === 'exato' || resolvido.tipoMatch === 'parcial') {
        if (resolvido.id_produto !== null) {
          // Busca o produto real no banco pelo ID resolvido pelo catálogo oficial
          const { data, error } = await supabase
            .from('produtos')
            .select(SELECT_COLS)
            .eq('id_produto', resolvido.id_produto)
            .limit(1);

          if (error) {
            console.error('[OrcamentoResolver] Erro ao buscar por ID do catálogo oficial:', error.message);
          } else if (data && data.length > 0) {
            candidatos = data.map((p: any) => ({ ...p, pesoUnitario: p.peso })) as ProdutoDb[];
          } else {
            // Catálogo resolveu mas produto não existe no banco — continua para busca textual
            console.warn(`[OrcamentoResolver] Catálogo oficial resolveu ID ${resolvido.id_produto} mas produto não existe no banco para termo "${termoOriginal}"`);
          }
        }
      } else if (resolvido.tipoMatch === 'ambiguo') {
        // Ambiguíade no catálogo oficial — sinaliza imediatamente sem ir ao banco
        // (caso raro: dois produtos com mesmo alias no catálogo — requer correção do catálogo)
        console.warn(`[OrcamentoResolver] Ambiguíade no catálogo oficial para "${termoOriginal}" — candidatos: ${resolvido.candidatos?.map(c => c.id_produto).join(', ')}`);
        // Deixa candidatos vazio e cai no banco textual abaixo
      }
    }

    // ── Prioridade 3-5: Busca textual no banco (apelido e descrição) ─────────────
    if (candidatos.length === 0) {
      const [resApelido, resDesc] = await Promise.all([
        supabase
          .from('produtos')
          .select(SELECT_COLS)
          .ilike('apelidos', `%${termoOriginal}%`),
        supabase
          .from('produtos')
          .select(SELECT_COLS)
          .ilike('descricao', `%${termoOriginal}%`)
      ]);

      const dataApelido = resApelido.data;
      const dataDesc = resDesc.data;
      const mapa = new Map<number, ProdutoDb>();
      
      if (dataDesc) dataDesc.forEach((p: any) => {
        mapa.set(p.id_produto, { ...p, pesoUnitario: p.peso } as ProdutoDb);
      });
      if (dataApelido) dataApelido.forEach((p: any) => {
        mapa.set(p.id_produto, { ...p, pesoUnitario: p.peso } as ProdutoDb);
      });
      const todos = Array.from(mapa.values());

      if (todos.length > 0) {
        // Apelido exato
        const exato = todos.filter(p => parsearApelidos(p.apelidos).includes(termoNorm));
        if (exato.length > 0) {
          candidatos = exato;
        } else {
          // Apelido parcial
          const parcial = todos.filter(p =>
            parsearApelidos(p.apelidos).some(ap => ap.includes(termoNorm) || termoNorm.includes(ap))
          );
          if (parcial.length > 0) {
            candidatos = parcial;
          } else {
            // Descrição
            const desc = todos.filter(p => normalizarTexto(p.descricao).includes(termoNorm));
            candidatos = desc;
          }
        }
      }
    }

    // ── Classificar e calcular ───────────────────────────────────────────────
    const itemResult: ResolverItemResult = {
      termo: termoOriginal,
      quantidade: req.quantidade,
      status: 'nao_encontrado',
      subtotal: null
    };

    if (candidatos.length === 0) {
      itemResult.status = 'nao_encontrado';
      todosSuccesso = false;
    } else if (candidatos.length > 1) {
      itemResult.status = 'ambiguo';
      itemResult.candidatos = candidatos;
      todosSuccesso = false;
    } else {
      const produto = candidatos[0];
      itemResult.produto = produto;

      if (!produto.ativo) {
        itemResult.status = 'inativo';
        todosSuccesso = false;
      } else if (produto.valorUnt == null) {
        itemResult.status = 'preco_incompleto';
        todosSuccesso = false;
      } else {
        // valorFixo null é tratado como 0 (regra documentada no MAESTRO-V2-CONTRATO.md)
        const vFixo = produto.valorFixo ?? 0;
        itemResult.status = 'sucesso';
        itemResult.subtotal = req.quantidade * produto.valorUnt + vFixo;
        if (totalGeral !== null) {
          totalGeral += itemResult.subtotal;
        }
      }
    }

    resultItens.push(itemResult);
  }

  if (!todosSuccesso) {
    totalGeral = null;
  }

  return {
    itens: resultItens,
    totalGeral
  };
}

// ─── Criador de mock para testes ───────────────────────────────────────────────

/** Cria um Supabase mock para testes unitários que não fazem chamada real ao banco */
export function criarSupabaseMock(catalogo: ProdutoDb[]): SupabaseClient {
  const mockFrom = (tabela: string) => {
    if (tabela !== 'produtos') {
      throw new Error(`[OrcamentoResolverMock] Tabela não autorizada: ${tabela}`);
    }

    let filtros: Array<(p: ProdutoDb) => boolean> = [];
    let limiteMax = 1000;

    const chain: any = {
      select: (_cols: string) => chain,
      eq: (campo: string, valor: any) => {
        filtros.push(p => (p as any)[campo] === valor);
        return chain;
      },
      ilike: (campo: string, padrao: string) => {
        const termoLower = padrao.replace(/%/g, '').toLowerCase();
        filtros.push(p => {
          const val = ((p as any)[campo] ?? '').toLowerCase();
          return val.includes(termoLower);
        });
        return chain;
      },
      limit: (n: number) => {
        limiteMax = n;
        return chain;
      },
      then: (resolve: (v: { data: ProdutoDb[]; error: null }) => void) => {
        const resultado = catalogo.filter(p => filtros.every(f => f(p))).slice(0, limiteMax);
        filtros = [];
        resolve({ data: resultado, error: null });
        return Promise.resolve();
      }
    };

    // Torna o chain "thenable" para que await funcione
    chain.then = (resolve: any, reject: any) => {
      const resultado = catalogo.filter(p => filtros.every(f => f(p))).slice(0, limiteMax);
      filtros = [];
      const val = { data: resultado, error: null };
      return Promise.resolve(val).then(resolve, reject);
    };

    return chain;
  };

  return { from: mockFrom } as unknown as SupabaseClient;
}
