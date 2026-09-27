import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Prazo de envio exibido na coluna ENVIO da lista de Pedidos com o card
 * "Em Producao" ligado (27/09/2026).
 *
 * FONTE: `propostas_os_setores.prazo` + `hora` — o prazo e a hora do boletim.
 *   O boletim grava a MESMA "data prevista de entrega" em dois lugares:
 *   `propostas_os.data_termino` (so a data; a hora fica sempre 00:00) e
 *   `propostas_os_setores.prazo`/`hora`, espelhados em todas as linhas de setor
 *   do pedido (`espelharPrazoNosSetores`). So o setor tem a hora, entao e ele.
 *
 * `prazo` e DATE e `hora` e TIME sem fuso: ja sao horario de Brasilia como
 *   digitados no boletim. Formata a string, sem passar por `Date` — converter
 *   deslocaria a hora.
 *
 * Retorna "24/09 16:30"; so a data quando nao ha hora; pedido sem prazo nao
 *   aparece no mapa.
 */
export async function buscarPrazoEnvioDosPedidos(idInts: number[]): Promise<Record<number, string>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const { data, error } = await client
    .from("propostas_os_setores")
    .select("id_int, prazo, hora")
    .in("id_int", ids)
    .not("prazo", "is", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[prazo-envio-lista] Falha ao ler propostas_os_setores:", error.message);
    return {};
  }

  // As linhas do pedido sao espelhadas; vale a primeira que tiver hora, como no
  // boletim (`lista.find((b) => b.hora)`), e a data da primeira com prazo.
  const porPedido = new Map<number, { prazo: string; hora: string | null }>();
  for (const linha of data ?? []) {
    const id = Number(linha.id_int);
    const prazo = String(linha.prazo ?? "").slice(0, 10);
    const hora = linha.hora ? String(linha.hora).slice(0, 5) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) continue;
    const atual = porPedido.get(id);
    if (!atual) porPedido.set(id, { prazo, hora });
    else if (!atual.hora && hora) porPedido.set(id, { prazo: atual.prazo, hora });
  }

  const resultado: Record<number, string> = {};
  for (const [id, { prazo, hora }] of porPedido) {
    const [, mes, dia] = prazo.split("-");
    resultado[id] = hora ? `${dia}/${mes} ${hora}` : `${dia}/${mes}`;
  }
  return resultado;
}
