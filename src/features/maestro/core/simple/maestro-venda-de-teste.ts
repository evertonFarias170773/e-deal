/**
 * maestro-venda-de-teste.ts
 *
 * Venda de teste fica FORA do faturamento. Espelho, no aplicativo, do predicado
 * `public.fn_venda_de_teste` que a visão do Dashboard usa
 * (supabase/migrations/20261002_faturamento_exclui_vendas_de_teste.sql).
 *
 * DECISÃO DO DONO (02/10/2026)
 *   Saem do faturamento os pedidos nos cadastros de teste 6, 11, 14 e 58613
 *   ("Teste Testando"), os dos vendedores "Everton Dev" e "TESTE AUTOMATIZADO"
 *   e os do login userteste1 (como vendedor do pedido ou como quem o criou).
 *   Nenhuma cobrança, boleto ou status muda: a exclusão é só na soma.
 *
 * AS DUAS LISTAS TÊM DE SER IGUAIS
 *   O total do Maestro vem da visão do banco; o detalhamento por vendedor e por
 *   empresa é somado aqui, linha a linha. Se as listas divergirem, o campo
 *   `conferencia.confere` do faturamento vira falso e o teste
 *   maestro-faturamento-gabarito falha. Mudou uma, mude a outra no mesmo commit.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const CLIENTES_DE_TESTE: readonly number[] = [6, 11, 14, 58613];
/** Em minúsculas e sem espaço nas pontas — a comparação é feita assim, como no banco. */
export const VENDEDORES_DE_TESTE: readonly string[] = ['everton dev', 'teste automatizado', 'userteste1'];
/** user_id do login userteste1 (usuarios.user_id). */
export const LOGINS_DE_TESTE: readonly string[] = ['264c562e-3fee-48c2-a071-d609e71cb8bb'];

export const CRITERIO_VENDA_DE_TESTE =
  'Exclui pedidos de teste: cadastros 6, 11, 14 e 58613, vendedores Everton Dev e TESTE AUTOMATIZADO, e o login userteste1.';

export interface PropostaParaTeste {
  id_cliente?: unknown;
  id_faturado?: unknown;
  vendedor?: unknown;
  user_id?: unknown;
}

function inteiro(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mesma regra de `public.fn_venda_de_teste`: recebe as colunas da PROPOSTA. */
export function ehVendaDeTeste(p: PropostaParaTeste): boolean {
  const cliente = inteiro(p.id_cliente);
  const faturado = inteiro(p.id_faturado);
  if (cliente != null && CLIENTES_DE_TESTE.includes(cliente)) return true;
  if (faturado != null && CLIENTES_DE_TESTE.includes(faturado)) return true;
  const vendedor = typeof p.vendedor === 'string' ? p.vendedor.trim().toLowerCase() : '';
  if (vendedor && VENDEDORES_DE_TESTE.includes(vendedor)) return true;
  const login = typeof p.user_id === 'string' ? p.user_id.trim().toLowerCase() : '';
  return login !== '' && LOGINS_DE_TESTE.includes(login);
}

const PAGINA = 1000;
const MAX_PAGINAS = 20;

/**
 * Números (id_int) das propostas de teste. Uma consulta larga no banco — o
 * `ilike` com curinga traz candidatos — e a regra exata aplicada aqui.
 * São poucas centenas de propostas; a leitura é paginada por garantia.
 */
export async function lerPropostasDeTeste(
  supabase: SupabaseClient,
): Promise<{ ids: Set<number>; error?: { message: string } }> {
  const ids = new Set<number>();
  const filtro = [
    `id_cliente.in.(${CLIENTES_DE_TESTE.join(',')})`,
    `id_faturado.in.(${CLIENTES_DE_TESTE.join(',')})`,
    ...VENDEDORES_DE_TESTE.map(v => `vendedor.ilike.*${v}*`),
    ...LOGINS_DE_TESTE.map(u => `user_id.eq.${u}`),
  ].join(',');

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await supabase
      .from('propostas')
      .select('id_int, id_cliente, id_faturado, vendedor, user_id')
      .or(filtro)
      .order('id_int', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) return { ids, error };
    const lote = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of lote) {
      const id = inteiro(r.id_int);
      if (id != null && ehVendaDeTeste(r)) ids.add(id);
    }
    if (lote.length < PAGINA) break;
  }
  return { ids };
}
