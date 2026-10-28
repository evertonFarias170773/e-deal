/**
 * Cotação automática da Azul Cargo (webhook `cotacao-azul` do n8n).
 *
 * POR QUE ESTE ARQUIVO EXISTE (27/10/2026)
 *   Até aqui a cotação pedia só o serviço ECOMM. O webhook passou a devolver,
 *   com `SiglaServico` vazio, TODOS os serviços do contrato da Ideal — hoje
 *   ECOMM, EXPRESSO e STANDARD — e cada um vira um card. Este módulo é a única
 *   regra de quais nomes entram e com que texto, porque esse texto vai para
 *   `cotacao_frete.servico` e `propostas.frete_escolhido`, e é por ele que o
 *   resto do sistema reconhece o transporte (ver `servicos-transportadora.ts`).
 *
 * OS NOMES
 *   - "ECOMM" continua "ECOMM": é o que sempre foi gravado, e a lista da aba
 *     Fretes já o trata como sinônimo de AZUL ECOMM.
 *   - STANDARD, EXPRESSO e PREMIUM gravam "AZUL STANDARD", "AZUL EXPRESSO" e
 *     "AZUL PREMIUM", os mesmos nomes da lista da aba Fretes. O nome cru
 *     ("STANDARD") cairia em INDEFINIDO em `normalizarTipoFrete` e em
 *     `exp__tipo_frete_do_texto`, e perderia o vínculo com a SVT.
 *   - Qualquer outro nome da Azul (os `_CORP`, por exemplo) é ignorado.
 *
 * RESPOSTA VAZIA
 *   Serviço fora do contrato faz a Azul devolver `Value: []`, e o webhook
 *   responde corpo vazio com HTTP 200. Isso é "nenhuma opção da Azul", não erro.
 *
 * A CAIXA SAI DO PESO (27/10/2026)
 *   O corpo mandava sempre a caixa cheia (36 x 32 x 23) e `Volume =
 *   ceil(gramas / 14500)`, e a Azul cobrava a cubagem da caixa cheia mesmo num
 *   pedido de 250 g — no EXPRESSO isso mais que dobrava o valor. Fatos da Azul,
 *   verificados em 27/10/2026 contra o webhook: `Peso` é o TOTAL do item (Volume
 *   1 e Volume 2 com Peso 20 dão o mesmo resultado); `Volume` multiplica só a
 *   cubagem; altura menor cota mais barato.
 *
 *   Regra, toda em `planejarCotacaoAzul`:
 *   - comprimento 32 e largura 23, fixos; altura por volume = peso do volume
 *     (kg) x 2,25, inteiro mais próximo, mínimo 1. Caixa cheia: 16 kg, altura 36;
 *   - para um peso total P e um divisor d: n = ceil((P/d) / 16) volumes de peso
 *     igual p = (P/d) / n. Vai `Volume = n`, `Peso = P/d` (total, 3 casas) e a
 *     altura calculada por p;
 *   - a margem é por serviço (`MARGEM_POR_SERVICO_AZUL`): 1,15 só no ECOMM,
 *     aplicada DEPOIS do Total x d; os demais a 1,0;
 *   - são DUAS cotações por pedido, em paralelo, uma por grupo:
 *       ECOMM  — `SiglaServico` "ECOMM"; limite de 30 kg por envio, então
 *                d = menor inteiro que deixa P/d em 30 kg ou menos. ValorTotal
 *                declarado também dividido por d, e o Total da resposta
 *                multiplicado por d (2 casas) ANTES da margem; prazo não muda;
 *       DEMAIS — `SiglaServico` vazio, d = 1, sem multiplicar nada; dessa
 *                resposta o ECOMM é descartado e ficam EXPRESSO, STANDARD e
 *                PREMIUM (60 kg por volume, sem limite por envio).
 *   Falha ou corpo vazio de um grupo não derruba o outro (ver frete.service).
 *   Os ids dos cards seguem por posição na lista final ("frete_azul_ecomm_0",
 *   "frete_azul_azul_expresso_1", ...), como antes: a recotação da Expedição e o
 *   frete complementar acham a opção escolhida por esse id.
 */
import type { PropostaFrete } from "@/features/orcamentos/types";

/** Nome devolvido pela Azul (`NomeServico`) → texto gravado no Vibe. */
const NOME_GRAVADO_POR_SERVICO_AZUL: Readonly<Record<string, string>> = {
  ECOMM: "ECOMM",
  STANDARD: "AZUL STANDARD",
  EXPRESSO: "AZUL EXPRESSO",
  PREMIUM: "AZUL PREMIUM"
};

/**
 * Margem sobre o Total da Azul, POR SERVIÇO gravado (28/10/2026). Até aqui era
 * 1,15 para todos; agora só o ECOMM leva os 15%. STANDARD, EXPRESSO e PREMIUM
 * vão a preço de custo (1,0) e o card não mostra "(+15%)" nem "Original".
 * Vale só para cotação nova: o que já está em `cotacao_frete` não muda.
 */
export const MARGEM_POR_SERVICO_AZUL: Readonly<Record<string, number>> = {
  ECOMM: 1.15,
  "AZUL STANDARD": 1,
  "AZUL EXPRESSO": 1,
  "AZUL PREMIUM": 1
};

/** Margem do serviço gravado; nome fora da tabela não leva acréscimo. */
export function margemDoServicoAzul(servicoGravado: string): number {
  return MARGEM_POR_SERVICO_AZUL[String(servicoGravado ?? "").trim().toUpperCase()] ?? 1;
}

/** Rótulo do acréscimo para o card ("+15%"), ou `null` quando a margem é 1,0. */
export function rotuloMargemAzul(servicoGravado: string): string | null {
  const margem = margemDoServicoAzul(servicoGravado);
  if (margem <= 1) return null;
  return `+${Math.round((margem - 1) * 100)}%`;
}

/** Caixa da Azul: comprimento e largura fixos; a altura sai do peso. */
export const CAIXA_AZUL = { comprimento: 32, largura: 23, alturaMaxima: 36 } as const;
/** 1 kg ocupa 2,25 cm de altura na caixa de 32 x 23. */
export const CM_DE_ALTURA_POR_KG = 2.25;
/** Peso que enche uma caixa (altura 36). */
export const KG_POR_VOLUME_AZUL = 16;
/** Limite da Azul por envio no ECOMM; acima disso a cotação é dividida. */
export const LIMITE_ENVIO_ECOMM_KG = 30;

export type GrupoCotacaoAzul = "ECOMM" | "DEMAIS";

export const GRUPOS_COTACAO_AZUL: Readonly<
  Record<GrupoCotacaoAzul, { sigla: string; limiteEnvioKg: number | null; servicosApi: readonly string[] }>
> = {
  ECOMM: { sigla: "ECOMM", limiteEnvioKg: LIMITE_ENVIO_ECOMM_KG, servicosApi: ["ECOMM"] },
  DEMAIS: { sigla: "", limiteEnvioKg: null, servicosApi: ["EXPRESSO", "STANDARD", "PREMIUM"] }
};

/** O que uma cotação da Azul manda e como lê a resposta. */
export type PlanoCotacaoAzul = {
  grupo: GrupoCotacaoAzul;
  /** Peso real do pedido, em kg. */
  pesoTotalKg: number;
  /** Em quantas cotações o peso foi dividido (só o ECOMM passa de 1). */
  divisor: number;
  /** `Itens[0].Volume`: caixas desta cotação. */
  volumes: number;
  /** `Itens[0].Peso`: total desta cotação (P/d), 3 casas. */
  pesoEnviadoKg: number;
  /** Peso de cada caixa, base da altura. */
  pesoPorVolumeKg: number;
  /** `Itens[0].Altura`. */
  altura: number;
};

/** Altura (cm) de uma caixa pelo peso que ela leva. */
export function alturaDoVolumeAzul(pesoVolumeKg: number): number {
  return Math.max(1, Math.round(pesoVolumeKg * CM_DE_ALTURA_POR_KG));
}

/** Divide o peso em cotações (d) e cada cotação em caixas (n), e tira a altura. */
export function planejarCotacaoAzul(pesoTotalKg: number, grupo: GrupoCotacaoAzul): PlanoCotacaoAzul {
  const peso = Math.max(0, Number(pesoTotalKg) || 0);
  const { limiteEnvioKg } = GRUPOS_COTACAO_AZUL[grupo];
  const divisor = limiteEnvioKg ? Math.max(1, Math.ceil(peso / limiteEnvioKg)) : 1;
  const pesoEnviado = peso / divisor;
  const volumes = Math.max(1, Math.ceil(pesoEnviado / KG_POR_VOLUME_AZUL));
  const pesoPorVolume = pesoEnviado / volumes;
  return {
    grupo,
    pesoTotalKg: peso,
    divisor,
    volumes,
    pesoEnviadoKg: Number(pesoEnviado.toFixed(3)),
    pesoPorVolumeKg: pesoPorVolume,
    altura: alturaDoVolumeAzul(pesoPorVolume)
  };
}

/** Corpo que o webhook `cotacao-azul` espera, para um plano. */
export function montarCorpoCotacaoAzul(plano: PlanoCotacaoAzul, input: { cep: string; valorTotal: number }) {
  const valorTotal = Number(input.valorTotal || 0) / plano.divisor;
  return {
    CEPDestino: input.cep.replace(/\D/g, ""),
    ValorTotal: Number(valorTotal.toFixed(2)),
    SiglaServico: GRUPOS_COTACAO_AZUL[plano.grupo].sigla,
    TaxaColeta: "false",
    TipoEntrega: "AEROPORTO",
    BaseOrigem: "Qns02",
    BaseDestino: "",
    Coleta: "false",
    Itens: [
      {
        Volume: plano.volumes,
        Peso: plano.pesoEnviadoKg,
        Altura: plano.altura,
        Comprimento: CAIXA_AZUL.comprimento,
        Largura: CAIXA_AZUL.largura
      }
    ]
  };
}

/** O texto gravado para um serviço da Azul, ou `null` quando ele não entra. */
export function nomeServicoAzul(nomeApi: unknown): string | null {
  const chave = String(nomeApi ?? "").trim().toUpperCase();
  return NOME_GRAVADO_POR_SERVICO_AZUL[chave] ?? null;
}

/**
 * Corpo do webhook → itens crus. Aceita array, objeto único (formato antigo)
 * e corpo vazio (zero opções). Qualquer outra coisa é resposta inválida.
 */
export function lerCorpoCotacaoAzul(corpo: string): Record<string, unknown>[] {
  if (!corpo.trim()) return [];
  const data: unknown = JSON.parse(corpo);
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  throw new Error("Resposta inválida da cotação Azul Cargo.");
}

/** Id transitório do card, por posição na lista final (ver cabeçalho). */
export function idCardAzul(servico: string, posicao: number): string {
  return `frete_azul_${servico.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${posicao}`;
}

/**
 * Itens crus de UMA cotação → cards da Azul do grupo do plano, nomeados, com o
 * Total multiplicado pelo divisor e a margem. O id aqui é provisório, por
 * posição dentro do grupo; `juntarCotacoesAzul` renumera na lista final.
 */
export function mapearCotacoesAzul(
  itens: Record<string, unknown>[],
  input: { id_int?: number | string; pesoGramas: number; plano: PlanoCotacaoAzul }
): PropostaFrete[] {
  const { plano } = input;
  const aceitos = GRUPOS_COTACAO_AZUL[plano.grupo].servicosApi;
  const cards: PropostaFrete[] = [];
  for (const item of itens) {
    const nomeApi = String(item.Servico ?? "").trim().toUpperCase();
    if (!aceitos.includes(nomeApi)) continue;
    const servico = nomeServicoAzul(nomeApi);
    if (servico === null) continue;

    const prazo = item.Prazo as number | undefined;
    // d envios ECOMM = d cotações iguais; o n8n só repassa o Total, então é só ele.
    const total = Number((Number(item.Total || 0) * plano.divisor).toFixed(2));
    const margem = margemDoServicoAzul(servico);
    const valorFinal = total * margem;
    const prazoText = prazo ? (prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`) : "Sob consulta";
    const idCotacao = item.ID_Cotacao !== undefined ? Number(item.ID_Cotacao) : undefined;
    const volumesTotais = plano.volumes * plano.divisor;
    const envios = plano.divisor > 1 ? ` | ${plano.divisor} envios` : "";
    // Com margem 1,0 o valor original é o próprio valor: não repete.
    const original = margem > 1 ? ` | Valor original: ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "";

    cards.push({
      id: idCardAzul(servico, cards.length),
      id_int: typeof input.id_int === "number" ? input.id_int : Number(input.id_int) || 0,
      transportadora: "Azul Cargo",
      servico,
      valor: valorFinal, // usar SEMPRE o valor final já com margem da Azul.
      prazo: prazoText,
      observacao: `Volumes: ${volumesTotais} | Peso: ${plano.pesoTotalKg.toFixed(2)} KG${envios}${original}`,
      escolhido: false,
      pesoUsado: input.pesoGramas,
      valorOriginal: total,
      valorMargem: valorFinal,
      volumes: volumesTotais,
      pesoKg: plano.pesoTotalKg,
      id_cotacao: idCotacao
    });
  }
  return cards;
}

/**
 * Junta as cotações dos grupos (ECOMM primeiro) numa lista só, com os ids por
 * posição final. Grupo que falhou entra em `erros` e não derruba o outro.
 */
export function juntarCotacoesAzul(
  resultados: readonly PromiseSettledResult<PropostaFrete[]>[]
): { cards: PropostaFrete[]; erros: unknown[] } {
  const cards: PropostaFrete[] = [];
  const erros: unknown[] = [];
  for (const r of resultados) {
    if (r.status === "rejected") {
      erros.push(r.reason);
      continue;
    }
    for (const card of r.value) cards.push({ ...card, id: idCardAzul(card.servico, cards.length) });
  }
  return { cards, erros };
}
