import { getSupabaseClient } from "@/lib/supabase/client";
import { marcarPronto, type AtorExpedicao } from "@/features/expedicao/services/expedicao-acoes.service";

/**
 * Fechamento da revisão do boletim: o que é do PEDIDO inteiro, não de um setor.
 *
 * Peso real por setor continua em `propostas_os_setores` (uma linha por setor).
 * Volume e peso bruto são do pedido — vivem em `expedicoes`, a mesma linha que a
 * Expedição já lê para etiqueta e pré-postagem dos Correios.
 */

export type RevisaoGeral = {
  qtdVolumes: string;
  tipoVolume: string;
  /** Peso bruto total (com embalagem) — é o que vai para a NF-e. */
  pesoBruto: string;
  /** Peso bruto de cada volume, na ordem. Só importa com mais de um volume. */
  pesosVolumes: string[];
};

export const REVISAO_GERAL_VAZIA: RevisaoGeral = {
  qtdVolumes: "",
  tipoVolume: "",
  pesoBruto: "",
  pesosVolumes: []
};

function numeroOuNulo(valor: string | undefined): number | null {
  const texto = (valor || "").trim().replace(",", ".");
  if (texto === "") return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function textoDeNumero(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

export async function carregarRevisaoGeral(idInt: number): Promise<RevisaoGeral> {
  const client = getSupabaseClient();
  if (!client) return REVISAO_GERAL_VAZIA;

  const { data, error } = await client
    .from("expedicoes")
    .select("qtd_volumes, tipo_volume, peso_bruto_kg, pesos_volumes")
    .eq("id_int", idInt)
    .maybeSingle();

  if (error || !data) return REVISAO_GERAL_VAZIA;

  return {
    qtdVolumes: textoDeNumero(data.qtd_volumes),
    tipoVolume: data.tipo_volume ? String(data.tipo_volume) : "",
    pesoBruto: textoDeNumero(data.peso_bruto_kg),
    pesosVolumes: Array.isArray(data.pesos_volumes)
      ? (data.pesos_volumes as unknown[]).map((p) => textoDeNumero(p))
      : []
  };
}

export async function salvarRevisaoGeral(
  idInt: number,
  dados: RevisaoGeral
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  const quantidade = numeroOuNulo(dados.qtdVolumes);
  // Só grava a lista quando ela significa algo: um volume não precisa de
  // detalhamento, e sobra de campos de uma contagem maior anterior viraria
  // ruído na NF.
  const pesos =
    quantidade && quantidade > 1
      ? dados.pesosVolumes.slice(0, quantidade).map((p) => numeroOuNulo(p))
      : null;

  const { error } = await client.from("expedicoes").upsert(
    {
      id_int: idInt,
      qtd_volumes: quantidade,
      tipo_volume: dados.tipoVolume.trim() ? dados.tipoVolume.trim() : null,
      peso_bruto_kg: numeroOuNulo(dados.pesoBruto),
      pesos_volumes: pesos,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id_int" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export type PendenciaRevisao = { setor: string; falta: string };

/**
 * O que impede a liberação. Devolve lista vazia quando está tudo pronto.
 *
 * A exigência é a que o dono definiu: TODOS os setores conferidos, mais volume e
 * peso do pedido. Um pedido sem peso chega na Expedição sem como emitir etiqueta
 * nem pré-postagem, e sem responsável não há a quem perguntar depois.
 */
export function validarRevisao(
  setores: string[],
  conferenciaPorSetor: Record<string, { peso_real?: string; responsavel_conferencia?: string }>,
  geral: RevisaoGeral
): PendenciaRevisao[] {
  const pendencias: PendenciaRevisao[] = [];

  for (const setor of setores) {
    const c = conferenciaPorSetor[setor] ?? {};
    const faltas: string[] = [];
    if (numeroOuNulo(c.peso_real) === null) faltas.push("peso real");
    if (!c.responsavel_conferencia?.trim()) faltas.push("responsável");
    if (faltas.length > 0) pendencias.push({ setor, falta: faltas.join(" e ") });
  }

  const geralFaltando: string[] = [];
  const quantidade = numeroOuNulo(geral.qtdVolumes);
  if (quantidade === null || quantidade < 1) geralFaltando.push("qtd de volumes");
  if (!geral.tipoVolume.trim()) geralFaltando.push("tipo de volume");
  if (numeroOuNulo(geral.pesoBruto) === null) geralFaltando.push("peso bruto total");

  if (quantidade !== null && quantidade > 1) {
    const informados = geral.pesosVolumes.slice(0, quantidade).filter((p) => numeroOuNulo(p) !== null);
    if (informados.length < quantidade) geralFaltando.push("peso bruto de cada volume");
  }

  if (geralFaltando.length > 0) {
    pendencias.push({ setor: "PEDIDO", falta: geralFaltando.join(", ") });
  }

  return pendencias;
}

/**
 * Grava o geral e libera o pedido para a Expedição.
 *
 * O status vai para EXPEDICAO por `marcarPronto`, a mesma função que o botão
 * "Marcar pronto" da tela de Expedição usa — inclusive a guarda de concorrência
 * e a trilha em os_status_log. Não existe um segundo caminho para o mesmo
 * estado.
 */
export async function confirmarRevisao(
  idInt: number,
  geral: RevisaoGeral,
  ator: AtorExpedicao
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  const salvo = await salvarRevisaoGeral(idInt, geral);
  if (!salvo.success) return salvo;

  // Status lido agora, não o que a tela viu ao abrir: o boletim fica aberto
  // muito tempo. A guarda de concorrência do marcarPronto continua valendo.
  const { data, error } = await client
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .maybeSingle();

  if (error || !data) return { success: false, error: "Não foi possível ler o status atual do pedido." };

  return marcarPronto(idInt, String(data.status_interno ?? ""), ator);
}
