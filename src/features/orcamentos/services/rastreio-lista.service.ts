import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarTipoFrete } from "@/features/expedicao/lib/tipo-frete";

/**
 * Dados de rastreio das propostas exibidas na lista de Orcamentos.
 *
 * POR QUE UMA CONSULTA A PARTE
 *   A lista de Orcamentos le `propostas`, e nem o tipo de frete nem o codigo de
 *   rastreio moram la. Enriquecer a consulta principal com join obrigaria a
 *   mexer no pipeline de leitura da lista inteira (service + mapper + tipo do
 *   item), que serve a muita coisa. Esta funcao roda depois, so para os id_int
 *   da pagina atual, no mesmo padrao do enriquecimento de chat que a tela ja faz.
 *
 * SOMENTE LEITURA. Nao altera expedicao, status nem nada da proposta.
 *
 * PRECEDENCIA DO CODIGO
 *   1. `expedicoes.codigo_rastreamento` — o que o expedidor confirmou no despacho.
 *   2. `expedicoes.correios_codigo_objeto` — o objeto da prepostagem.
 *   3. `propostas_os.codigo_rastreamento` — registro antigo, anterior a tabela
 *      `expedicoes`; sem ele, pedido despachado antes de 15/08/2026 ficaria sem
 *      rastreio na lista.
 *
 * COMO O FRETE VIRA "CORREIOS"
 *   `expedicoes.tipo_frete` quando existe (ja normalizado na origem). Sem linha
 *   de expedicao, cai no texto livre de `cotacao_frete.servico` passado por
 *   `normalizarTipoFrete` — a MESMA funcao que a Expedicao usa, para as duas
 *   telas nunca discordarem sobre o que e Correios.
 */
export interface RastreioDaProposta {
  codigo: string;
  ehCorreios: boolean;
}

export async function buscarRastreioDasPropostas(
  idInts: number[]
): Promise<Record<number, RastreioDaProposta>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const [expRes, osRes, coteRes] = await Promise.all([
    client
      .from("expedicoes")
      .select("id_int, tipo_frete, codigo_rastreamento, correios_codigo_objeto")
      .in("id_int", ids),
    client.from("propostas_os").select("id_int, codigo_rastreamento").in("id_int", ids),
    client.from("cotacao_frete").select("id_int, servico").eq("escolhido", true).in("id_int", ids)
  ]);

  if (expRes.error) console.warn("[rastreio-lista] Erro ao ler expedicoes:", expRes.error);
  if (osRes.error) console.warn("[rastreio-lista] Erro ao ler propostas_os:", osRes.error);
  if (coteRes.error) console.warn("[rastreio-lista] Erro ao ler cotacao_frete:", coteRes.error);

  const codigoPorId = new Map<number, string>();
  const correiosPorId = new Map<number, boolean>();

  for (const linha of coteRes.data ?? []) {
    const id = Number(linha.id_int);
    correiosPorId.set(id, normalizarTipoFrete(linha.servico as string | null) === "CORREIOS");
  }

  for (const linha of osRes.data ?? []) {
    const id = Number(linha.id_int);
    const codigo = String(linha.codigo_rastreamento ?? "").trim();
    if (codigo) codigoPorId.set(id, codigo);
  }

  // Expedicao por ultimo: e a fonte mais forte e sobrescreve a OS antiga.
  for (const linha of expRes.data ?? []) {
    const id = Number(linha.id_int);
    const codigo =
      String(linha.codigo_rastreamento ?? "").trim() ||
      String(linha.correios_codigo_objeto ?? "").trim();
    if (codigo) codigoPorId.set(id, codigo);
    const tipo = String(linha.tipo_frete ?? "").trim().toUpperCase();
    if (tipo) correiosPorId.set(id, tipo === "CORREIOS");
  }

  const resultado: Record<number, RastreioDaProposta> = {};
  for (const id of ids) {
    const codigo = codigoPorId.get(id) ?? "";
    if (!codigo) continue;
    resultado[id] = { codigo, ehCorreios: correiosPorId.get(id) === true };
  }
  return resultado;
}
