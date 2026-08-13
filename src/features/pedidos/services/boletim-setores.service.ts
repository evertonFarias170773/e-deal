import { getSupabaseClient } from "@/lib/supabase/client";
import { sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";
import { consolidarFases, normalizarFaseSetor, statusInternoDaFase, type FaseSetor } from "../status-setor";

/**
 * Boletim de produção de cada setor — `public.propostas_os_setores`.
 *
 * Até 13/08/2026 isso morava em `public.pedidos_artes`, que é a tabela de ARTE.
 * Não era só o nome: cada boletim de setor criava uma linha que contava como
 * evidência de arte da proposta — `check_and_promote_proposta` lê o status da
 * linha mais recente, e `liberarPropostaParaProducao` exige que TODAS estejam
 * APROVADO. Um boletim em "EM ARTE" travava a liberação do pedido.
 *
 * A divisão passou a ser:
 *   propostas            → o pedido (dados globais)
 *   propostas_os         → cabeçalho da OS, 1 por pedido
 *   propostas_os_setores → 1 por setor: prazo, hora, fase e conferência
 *   pedidos_artes        → só arte/briefing
 */

/** Revisão/conferência do setor: cada um embala e confere a sua parte. */
export interface ConferenciaSetor {
  peso_real?: string;
  qtd_volumes?: string;
  tipo_volume?: string;
  responsavel_conferencia?: string;
}

export interface BoletimSetor {
  id: string;
  idInt: number;
  setor: string | null;
  prazo: string | null;
  hora: string | null;
  fase: FaseSetor;
  conferencia: ConferenciaSetor;
}

const BOLETIM_SELECT =
  "id, id_int, setor, prazo, hora, status_producao, peso_real_kg, qtd_volumes, tipo_volume, responsavel_conferencia, created_at";

/** Número vindo de input: aceita vírgula decimal; vazio vira null. */
function numeroOuNulo(valor: string | undefined): number | null {
  const texto = (valor || "").trim().replace(",", ".");
  if (texto === "") return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function textoDeNumero(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

function mapBoletim(row: Record<string, unknown>): BoletimSetor {
  return {
    id: String(row.id),
    idInt: Number(row.id_int),
    setor: row.setor ? String(row.setor) : null,
    prazo: row.prazo ? String(row.prazo).slice(0, 10) : null,
    hora: row.hora ? String(row.hora).slice(0, 5) : null,
    fase: normalizarFaseSetor(row.status_producao as string | null),
    conferencia: {
      peso_real: textoDeNumero(row.peso_real_kg),
      qtd_volumes: textoDeNumero(row.qtd_volumes),
      tipo_volume: row.tipo_volume ? String(row.tipo_volume) : "",
      responsavel_conferencia: row.responsavel_conferencia ? String(row.responsavel_conferencia) : ""
    }
  };
}

/** Lista os boletins da proposta, um por setor, na ordem de criação. */
export async function listarBoletinsDaProposta(idInt: number): Promise<BoletimSetor[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("propostas_os_setores")
    .select(BOLETIM_SELECT)
    .eq("id_int", idInt)
    .order("created_at", { ascending: true });

  if (error || !data) {
    if (error) console.error("[BoletimSetoresService] Erro ao listar boletins:", error);
    return [];
  }

  return data.map(mapBoletim).sort((a, b) => (a.setor || "￿").localeCompare(b.setor || "￿", "pt-BR"));
}

/** Carrega um boletim pelo seu id. */
export async function carregarBoletimPorId(idBoletim: string): Promise<BoletimSetor | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("propostas_os_setores")
    .select(BOLETIM_SELECT)
    .eq("id", idBoletim)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[BoletimSetoresService] Erro ao carregar boletim:", error);
    return null;
  }
  return mapBoletim(data);
}

export interface SalvarBoletimInput {
  /** Boletim existente. Ausente = criar o do setor informado. */
  id?: string | null;
  idInt: number;
  setor: string | null;
  prazo: string | null;
  hora: string | null;
}

export type SalvarBoletimResult =
  | { success: true; boletim: BoletimSetor }
  | { success: false; error: string };

/**
 * Cria ou atualiza o boletim de um setor. A unicidade (id_int, setor) é
 * garantida por constraint no banco.
 */
export async function salvarBoletimSetor(input: SalvarBoletimInput): Promise<SalvarBoletimResult> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  const payload = {
    setor: input.setor?.trim() ? input.setor.trim().toUpperCase() : null,
    prazo: input.prazo?.trim() ? input.prazo.trim() : null,
    hora: input.hora?.trim() ? input.hora.trim() : null
  };

  if (input.id) {
    const { data, error } = await client
      .from("propostas_os_setores")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .select(BOLETIM_SELECT)
      .maybeSingle();

    if (error) {
      console.error("[BoletimSetoresService] Erro ao atualizar boletim:", error);
      return { success: false, error: traduzirErroBoletim(error) };
    }
    if (!data) return { success: false, error: "Boletim não encontrado para atualização." };
    return { success: true, boletim: mapBoletim(data) };
  }

  if (!payload.setor) {
    return { success: false, error: "Informe o setor para abrir o boletim." };
  }

  // A OS (propostas_os) é o cabeçalho do pedido e pode ainda não existir; o
  // vínculo obrigatório é o id_int.
  const { data: os } = await client
    .from("propostas_os")
    .select("id")
    .eq("id_int", input.idInt)
    .limit(1);

  const { data, error } = await client
    .from("propostas_os_setores")
    .insert({ id_int: input.idInt, id_os: os && os.length > 0 ? os[0].id : null, ...payload })
    .select(BOLETIM_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[BoletimSetoresService] Erro ao criar boletim:", error);
    return { success: false, error: traduzirErroBoletim(error) };
  }
  if (!data) return { success: false, error: "O banco não retornou o boletim criado." };
  return { success: true, boletim: mapBoletim(data) };
}

function traduzirErroBoletim(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "Já existe um boletim deste setor para esta proposta.";
  }
  return error.message || "Falha ao gravar o boletim.";
}

/**
 * Grava a conferência de cada setor. Só toca nos setores presentes no mapa, e
 * cria a linha do setor que ainda não tem boletim (é o mesmo registro).
 */
export async function salvarConferenciaDosSetores(
  idInt: number,
  conferenciaPorSetor: Record<string, ConferenciaSetor>
): Promise<{ success: boolean; error?: string }> {
  const setores = Object.keys(conferenciaPorSetor);
  if (setores.length === 0) return { success: true };

  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  const agora = new Date().toISOString();
  const linhas = setores.map((setor) => {
    const dados = conferenciaPorSetor[setor] ?? {};
    return {
      id_int: idInt,
      setor: setor.trim().toUpperCase(),
      peso_real_kg: numeroOuNulo(dados.peso_real),
      qtd_volumes: numeroOuNulo(dados.qtd_volumes),
      tipo_volume: dados.tipo_volume?.trim() ? dados.tipo_volume.trim() : null,
      responsavel_conferencia: dados.responsavel_conferencia?.trim()
        ? dados.responsavel_conferencia.trim()
        : null,
      updated_at: agora
    };
  });

  const { error } = await client
    .from("propostas_os_setores")
    .upsert(linhas, { onConflict: "id_int,setor" });

  if (error) {
    console.error("[BoletimSetoresService] Erro ao gravar a conferência dos setores:", error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Move a fase de UM setor e espelha a consolidação no status do pedido.
 *
 * `propostas.status_interno` recebe a fase do setor MENOS adiantado — é ele que
 * segura a entrega. Quando todos concluem, o status do pedido fica como está: a
 * saída da produção continua pelo caminho existente, e promover aqui tiraria a
 * OS da lista sem colocá-la em lugar nenhum.
 *
 * A consolidação relê os setores do banco em vez de confiar no estado da tela:
 * dois operadores podem estar movendo setores diferentes ao mesmo tempo.
 */
export async function atualizarFaseSetor(
  idInt: number,
  idBoletim: string,
  setor: string,
  novaFase: FaseSetor,
  faseAnterior: FaseSetor
): Promise<{ success: boolean; error?: string; statusInterno?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Supabase client not initialized" };

  const agora = new Date().toISOString();
  const { error } = await client
    .from("propostas_os_setores")
    .update({ status_producao: novaFase, status_producao_em: agora, updated_at: agora })
    .eq("id", idBoletim);

  if (error) {
    console.error("[BoletimSetoresService] Erro ao atualizar fase do setor:", error);
    return { success: false, error: error.message };
  }

  let statusInterno: string | undefined;
  const { data: setores } = await client
    .from("propostas_os_setores")
    .select("status_producao")
    .eq("id_int", idInt);

  const consolidado = consolidarFases((setores ?? []).map((s) => normalizarFaseSetor(s.status_producao)));
  const novoStatus = consolidado ? statusInternoDaFase(consolidado.fase) : null;
  if (novoStatus) {
    const { error: erroProposta } = await client
      .from("propostas")
      .update({ status_interno: novoStatus })
      .eq("id_int", idInt);
    if (erroProposta) {
      // A fase do setor já está gravada — o espelho é secundário e não desfaz.
      console.warn("[BoletimSetoresService] Fase gravada, mas o status do pedido não:", erroProposta.message);
    } else {
      statusInterno = novoStatus;
    }
  }

  await sendPropostaChatMessage({
    id_int: idInt,
    mensagem: `Setor ${setor}: fase de produção alterada de [${faseAnterior}] para [${novaFase}] pelo painel geral.`,
    tipo: "SISTEMA",
    autor_nome: "Operador (Lista)",
    autor_uid: null,
    autor_email: null,
    setor: "PRODUCAO",
    visivel_externo: false,
    anexos: null,
    id_cliente: null,
    avatar: null
  });

  return { success: true, statusInterno };
}
