import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarTipoFrete } from "@/features/expedicao/lib/tipo-frete";

/**
 * Formato oficial do objeto dos Correios: duas letras, nove digitos e o sufixo
 * do pais (AD823485091BR). E evidencia por si so — vale quando o transporte nao
 * ficou registrado como Correios em lugar nenhum, caso real de pedido cuja
 * cotacao foi gravada como "Sem custo" ou com o nome de outra transportadora.
 */
function pareceObjetoCorreios(codigo: string): boolean {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(codigo.trim().toUpperCase());
}

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
 * COMO O FRETE VIRA "CORREIOS" — TRES EVIDENCIAS, QUALQUER UMA BASTA
 *   1. `expedicoes.tipo_frete` normalizado por `normalizarTipoFrete` (a MESMA
 *      funcao que a Expedicao usa), o que faz SEDEX e PAC contarem.
 *   2. `cotacao_frete.servico` pelo mesmo normalizador.
 *   3. objeto de prepostagem gravado, ou codigo no formato oficial dos Correios.
 *
 *   Nenhuma NEGA as outras. Ate 20/08/2026 a regra era em cascata e
 *   `expedicoes.tipo_frete` sobrescrevia o resultado da cotacao — inclusive com
 *   `false`. Metade dos pedidos com rastreio real tem cotacao gravada como
 *   "Sem custo" ou com o nome de outra transportadora (#20481, #18360, #20464),
 *   e dependiam de uma unica coluna estar certa para a acao aparecer.
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
  // Objeto de prepostagem dos Correios: por definicao, e Correios.
  const temObjetoCorreios = new Set<number>();

  for (const linha of coteRes.data ?? []) {
    const id = Number(linha.id_int);
    if (normalizarTipoFrete(linha.servico as string | null) === "CORREIOS") {
      correiosPorId.set(id, true);
    }
  }

  for (const linha of osRes.data ?? []) {
    const id = Number(linha.id_int);
    const codigo = String(linha.codigo_rastreamento ?? "").trim();
    if (codigo) codigoPorId.set(id, codigo);
  }

  // Expedicao por ultimo: e a fonte mais forte e sobrescreve a OS antiga.
  for (const linha of expRes.data ?? []) {
    const id = Number(linha.id_int);
    const objeto = String(linha.correios_codigo_objeto ?? "").trim();
    const codigo = String(linha.codigo_rastreamento ?? "").trim() || objeto;
    if (codigo) codigoPorId.set(id, codigo);
    if (objeto) temObjetoCorreios.add(id);
    // Passa pelo normalizador em vez de comparar com a string "CORREIOS": hoje
    // a coluna so guarda valores ja canonicos, mas assim SEDEX ou PAC gravados
    // crus tambem contam, que e a regra pedida.
    if (normalizarTipoFrete(linha.tipo_frete as string | null) === "CORREIOS") {
      correiosPorId.set(id, true);
    }
  }

  const resultado: Record<number, RastreioDaProposta> = {};
  for (const id of ids) {
    const codigo = codigoPorId.get(id) ?? "";
    if (!codigo) continue;
    // Tres evidencias, qualquer uma basta. Nenhuma delas NEGA as outras: antes,
    // `expedicoes.tipo_frete` sobrescrevia o resultado da cotacao com `false` e
    // derrubava casos legitimos.
    const ehCorreios =
      correiosPorId.get(id) === true || temObjetoCorreios.has(id) || pareceObjetoCorreios(codigo);
    resultado[id] = { codigo, ehCorreios };
  }
  return resultado;
}
