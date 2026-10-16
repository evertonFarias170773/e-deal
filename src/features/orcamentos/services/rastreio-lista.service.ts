import { getSupabaseClient } from "@/lib/supabase/client";
import { normalizarTipoFrete } from "@/features/expedicao/lib/tipo-frete";
import { despachoEhCorreios, podeVerConhecimento } from "@/features/expedicao/lib/conhecimento";

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
 * COMO O FRETE VIRA "CORREIOS" — O DESPACHO (15/10/2026)
 *   So o despacho decide (`despachoEhCorreios`, em expedicao/lib/conhecimento):
 *   `expedicoes.tipo_frete` CORREIOS (SEDEX e PAC contam, via `normalizarTipoFrete`),
 *   ou objeto de prepostagem gravado. Sem tipo de despacho registrado (pedido
 *   anterior a tabela `expedicoes`) vale o formato oficial do objeto. A COTACAO
 *   ESCOLHIDA NAO DECIDE MAIS: `expedicoes.codigo_rastreamento` tambem guarda o
 *   "Conhecimento" de TRANSPORTADORA e MOTOBOY, e um pedido cotado como SEDEX mas
 *   despachado por transportadora nao pode virar consulta dos Correios.
 */

export interface RastreioDaProposta {
  codigo: string;
  ehCorreios: boolean;
  /** Despacho TRANSPORTADORA/MOTOBOY com o numero preenchido: o menu oferece "Ver conhecimento". */
  ehConhecimento: boolean;
}

export async function buscarRastreioDasPropostas(
  idInts: number[]
): Promise<Record<number, RastreioDaProposta>> {
  const client = getSupabaseClient();
  const ids = Array.from(new Set(idInts.filter((n) => Number.isFinite(n) && n > 0)));
  if (!client || ids.length === 0) return {};

  const [expRes, osRes] = await Promise.all([
    client
      .from("expedicoes")
      .select("id_int, tipo_frete, codigo_rastreamento, correios_codigo_objeto")
      .in("id_int", ids),
    client.from("propostas_os").select("id_int, codigo_rastreamento").in("id_int", ids)
  ]);

  if (expRes.error) console.warn("[rastreio-lista] Erro ao ler expedicoes:", expRes.error);
  if (osRes.error) console.warn("[rastreio-lista] Erro ao ler propostas_os:", osRes.error);

  const codigoPorId = new Map<number, string>();
  // Tipo do DESPACHO por pedido (normalizado); ausente = nao ha despacho registrado.
  const tipoDespachoPorId = new Map<number, string>();
  // Objeto de prepostagem dos Correios: por definicao, e Correios.
  const temObjetoCorreios = new Set<number>();

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
    if (String(linha.tipo_frete ?? "").trim()) {
      tipoDespachoPorId.set(id, normalizarTipoFrete(linha.tipo_frete as string | null));
    }
  }

  const resultado: Record<number, RastreioDaProposta> = {};
  for (const id of ids) {
    const codigo = codigoPorId.get(id) ?? "";
    if (!codigo) continue;
    // So o despacho decide (ver o bloco no topo): tipo CORREIOS, objeto de prepostagem ou, sem
    // despacho registrado, o formato oficial.
    const despacho = {
      tipoFrete: tipoDespachoPorId.get(id) ?? null,
      correiosCodigoObjeto: temObjetoCorreios.has(id) ? "objeto" : null,
      codigo
    };
    resultado[id] = { codigo, ehCorreios: despachoEhCorreios(despacho), ehConhecimento: podeVerConhecimento(despacho) };
  }
  return resultado;
}
