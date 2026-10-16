/**
 * Pedido do sistema antigo (16/10/2026).
 *
 * A partir de 16/10/2026 todo pedido nasce no Vibe, e a OS Ideal (o número do
 * pedido no sistema antigo, gravado em `pagamentos_v2.os_ideal`) só é pedida
 * quando o usuário marca "Pedido do sistema antigo" no modal Criar cobrança.
 * A marca fica em `propostas.is_sistema_antigo`:
 *
 *   null  = proposta anterior à mudança, não classificada (não presumir "novo");
 *   false = pedido 100% Vibe;
 *   true  = pedido que veio do sistema antigo.
 *
 * A exigência da OS vale só na tela, por decisão do Everton: não há rota nem
 * gatilho que a repita.
 *
 * A gravação da marca tem uma exceção: proposta avulsa com `valor_total` vazio
 * ou zero não é tocada. O gatilho `tg_propostas_valor_total_avulsa` preenche
 * `valor_total` em qualquer UPDATE dessas linhas (182 avulsas antigas em
 * 16/10/2026), e gravar a marca nelas mudaria o valor do pedido. Nesse caso o
 * checkbox continua valendo para a cobrança, mas a proposta fica como estava.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const ROTULO_SISTEMA_ANTIGO = "Pedido do sistema antigo";
export const MENSAGEM_OS_IDEAL_OBRIGATORIA = "Informe a OS Ideal do sistema antigo para gerar a cobrança.";

export type MarcaSistemaAntigoGravada = {
  isSistemaAntigo: boolean | null;
  isAvulso: boolean | null;
  valorTotal: number | null;
};

export type DecisaoGravacaoMarca = "GRAVAR" | "IGUAL" | "AVULSA_SEM_TOTAL";

/** Valor com que o checkbox abre: só vem marcado quando a proposta já está gravada como do sistema antigo. */
export function checkboxInicialSistemaAntigo(gravada: MarcaSistemaAntigoGravada | null): boolean {
  return gravada?.isSistemaAntigo === true;
}

/** Erro da tela, ou null quando a cobrança pode seguir. Desmarcado nunca exige a OS. */
export function validarOsIdeal(sistemaAntigo: boolean, osIdeal: string): string | null {
  if (!sistemaAntigo) return null;
  return osIdeal.trim() ? null : MENSAGEM_OS_IDEAL_OBRIGATORIA;
}

/**
 * OS que vai para a cobrança. Desmarcado manda vazio, que o createCobranca grava
 * como nulo, mesmo que o formulário tenha vindo pré-preenchido com a OS de uma
 * cobrança anterior.
 */
export function osIdealDaCobranca(sistemaAntigo: boolean, osIdeal: string): string {
  return sistemaAntigo ? osIdeal.trim() : "";
}

/** Proposta que o gatilho de avulsa reescreveria em qualquer UPDATE. */
export function ehAvulsaSemValorTotal(gravada: MarcaSistemaAntigoGravada): boolean {
  return gravada.isAvulso === true && !(gravada.valorTotal != null && gravada.valorTotal > 0);
}

export function decidirGravacaoMarca(gravada: MarcaSistemaAntigoGravada, novo: boolean): DecisaoGravacaoMarca {
  if (ehAvulsaSemValorTotal(gravada)) return "AVULSA_SEM_TOTAL";
  if (gravada.isSistemaAntigo === novo) return "IGUAL";
  return "GRAVAR";
}

function paraNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export async function lerMarcaSistemaAntigo(
  client: SupabaseClient,
  idInt: number
): Promise<MarcaSistemaAntigoGravada | null> {
  const { data, error } = await client
    .from("propostas")
    .select("is_sistema_antigo, is_avulso, valor_total")
    .eq("id_int", idInt)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as Record<string, unknown>;
  return {
    isSistemaAntigo: typeof linha.is_sistema_antigo === "boolean" ? linha.is_sistema_antigo : null,
    isAvulso: typeof linha.is_avulso === "boolean" ? linha.is_avulso : null,
    valorTotal: paraNumero(linha.valor_total)
  };
}

/**
 * Grava a marca depois que a cobrança foi criada. Relê a proposta na hora (o
 * modal pode ter ficado aberto) e só escreve quando o valor muda. O UPDATE leva
 * de novo a condição da avulsa no filtro, para o banco recusar a linha mesmo se
 * ela tiver mudado entre a leitura e a escrita.
 *
 * O retorno traz as colunas do `.or()` DE PROPÓSITO. Em escrita que devolve
 * linhas, o PostgREST repete o `or` no SELECT externo, que só enxerga as colunas
 * do `.select(...)`; com `.select("id_int")` o banco respondia 42703 ("column
 * propostas.is_avulso does not exist") e a marca nunca era gravada (16/10/2026,
 * provado por EXPLAIN com o papel authenticated). Mesma armadilha do 23681; o
 * teste patch-sem-or-em-retorno-estreito acusa o caso.
 */
export async function gravarMarcaSistemaAntigo(
  client: SupabaseClient,
  idInt: number,
  novo: boolean
): Promise<{ decisao: DecisaoGravacaoMarca | "SEM_PROPOSTA"; gravou: boolean; erro?: string }> {
  const gravada = await lerMarcaSistemaAntigo(client, idInt);
  if (!gravada) return { decisao: "SEM_PROPOSTA", gravou: false };

  const decisao = decidirGravacaoMarca(gravada, novo);
  if (decisao !== "GRAVAR") return { decisao, gravou: false };

  const { data, error } = await client
    .from("propostas")
    .update({ is_sistema_antigo: novo })
    .eq("id_int", idInt)
    .or("is_avulso.is.null,is_avulso.is.false,valor_total.gt.0")
    .select("id_int, is_avulso, valor_total");
  if (error) return { decisao, gravou: false, erro: error.message };
  return { decisao, gravou: Array.isArray(data) && data.length > 0 };
}

/**
 * Corte da marca automática: deploy do modal com o checkbox (16/10/2026, ~14:50
 * UTC). Proposta criada a partir daqui nasceu no Vibe; a anterior fica NULL (não
 * classificada) e segue em conferência manual, mesmo paga pelo link.
 */
export const CORTE_PEDIDO_VIBE_ISO = "2026-10-16T14:50:00Z";

export type DecisaoMarcaVibe = "GRAVAR" | "JA_MARCADA" | "ANTERIOR_AO_CORTE" | "AVULSA_SEM_TOTAL" | "SEM_PROPOSTA";

export type PropostaParaMarcaVibe = {
  isSistemaAntigo: boolean | null;
  isAvulso: boolean | null;
  valorTotal: number | null;
  createdAt: string | null;
};

/**
 * Cobrança criada fora do modal (área do cliente, 16/10/2026): só NULL vira
 * false, só em proposta criada a partir do corte, nunca em avulsa sem
 * valor_total. Diferente do modal, nunca sobrescreve uma marca já gravada —
 * nem true, nem false.
 */
export function decidirMarcaVibe(proposta: PropostaParaMarcaVibe): DecisaoMarcaVibe {
  if (proposta.isSistemaAntigo !== null) return "JA_MARCADA";
  const criada = proposta.createdAt ? Date.parse(proposta.createdAt) : NaN;
  if (!Number.isFinite(criada) || criada < Date.parse(CORTE_PEDIDO_VIBE_ISO)) return "ANTERIOR_AO_CORTE";
  if (proposta.isAvulso === true && !(proposta.valorTotal != null && proposta.valorTotal > 0)) return "AVULSA_SEM_TOTAL";
  return "GRAVAR";
}

/**
 * Grava `is_sistema_antigo = false` depois que a área do cliente criou a
 * cobrança. Lê antes para não mandar UPDATE à toa, e repete as três condições
 * DENTRO do UPDATE (marca nula, criada a partir do corte, trava da avulsa), para
 * o banco recusar a linha se ela mudou entre a leitura e a escrita. O retorno
 * traz as colunas de todos os filtros (ver patch-sem-or-em-retorno-estreito).
 * Nunca lança: quem chama só registra o desfecho no log.
 */
export async function gravarMarcaVibePelaAreaCliente(
  client: SupabaseClient,
  idInt: number
): Promise<{ decisao: DecisaoMarcaVibe; gravou: boolean; erro?: string }> {
  try {
    const { data: lida, error: erroLeitura } = await client
      .from("propostas")
      .select("is_sistema_antigo, is_avulso, valor_total, created_at")
      .eq("id_int", idInt)
      .maybeSingle();
    if (erroLeitura) return { decisao: "SEM_PROPOSTA", gravou: false, erro: erroLeitura.message };
    if (!lida) return { decisao: "SEM_PROPOSTA", gravou: false };
    const linha = lida as Record<string, unknown>;
    const decisao = decidirMarcaVibe({
      isSistemaAntigo: typeof linha.is_sistema_antigo === "boolean" ? linha.is_sistema_antigo : null,
      isAvulso: typeof linha.is_avulso === "boolean" ? linha.is_avulso : null,
      valorTotal: paraNumero(linha.valor_total),
      createdAt: typeof linha.created_at === "string" ? linha.created_at : null
    });
    if (decisao !== "GRAVAR") return { decisao, gravou: false };

    const { data, error } = await client
      .from("propostas")
      .update({ is_sistema_antigo: false })
      .eq("id_int", idInt)
      .is("is_sistema_antigo", null)
      .gte("created_at", CORTE_PEDIDO_VIBE_ISO)
      .or("is_avulso.is.null,is_avulso.is.false,valor_total.gt.0")
      .select("id_int, is_sistema_antigo, created_at, is_avulso, valor_total");
    if (error) return { decisao, gravou: false, erro: error.message };
    return { decisao, gravou: Array.isArray(data) && data.length > 0 };
  } catch (erro) {
    return { decisao: "SEM_PROPOSTA", gravou: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
