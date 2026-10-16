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
    .select("id_int");
  if (error) return { decisao, gravou: false, erro: error.message };
  return { decisao, gravou: Array.isArray(data) && data.length > 0 };
}
