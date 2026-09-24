import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * Cliente da recotação de frete do despacho (Parte C, Etapa 1).
 *
 * A rota cota e devolve. Desde 24/09/2026 ela REGISTRA o resultado em
 * `expedicao_recotacao_consultas` (so o servidor grava ali) — e a fonte da trava
 * do despacho. Frete e total da proposta continuam intocados: nem
 * `cotacao_frete`, nem `propostas.valor_frete`/`valor_total`, nem Conta Corrente.
 *
 * Mesmo desenho de `correios.client.ts`: o token sai da sessão do browser e vai
 * no header, porque a rota autentica por Bearer OU cookie.
 */

async function tokenSessao(): Promise<string | null> {
  const client = getSupabaseClient();
  const sessionResult = client ? await client.auth.getSession() : null;
  return sessionResult?.data?.session?.access_token ?? null;
}

/** Uma opção cotada agora, já comparada com o frete que a proposta cobra hoje. */
export interface OpcaoRecotacao {
  id: string;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  /** `valor − freteAtual`. Negativo = barateia (crédito futuro ao cliente). */
  diferenca: number;
  /** `valor <= 150`. Nesta etapa é rótulo informativo: nada é gravado. */
  dentroDaAlcada: boolean;
}

export interface RecotacaoResult {
  success: boolean;
  errorMessage?: string;
  freteAtual?: number;
  subtotalItens?: number;
  pesoGramas?: number;
  pesoOrigem?: string | null;
  endereco?: { rotulo: string; cep: string; cidade: string; uf: string } | null;
  opcoes?: OpcaoRecotacao[];
  avisos?: string[];
}

export async function recotarFrete(
  idInt: number,
  idEnderecoEntrega?: string | null
): Promise<RecotacaoResult> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/cotar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, id_endereco_entrega: idEnderecoEntrega ?? null })
    });
    const data = (await res.json().catch(() => null)) as (RecotacaoResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha ao recotar (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Resultado de aplicar UMA opcao (Parte C, Etapa 2). */
export interface AplicacaoRecotacao {
  success: boolean;
  errorMessage?: string;
  /** true quando a chave ja tinha sido aplicada: nada foi gravado de novo. */
  idempotente?: boolean;
  freteAnterior?: number;
  freteNovo?: number;
  diferenca?: number;
  totalAnterior?: number;
  totalNovo?: number;
  transportadora?: string;
  servico?: string;
  prazo?: string;
  /** Peso e CEP que a recotacao usou — passam a ser a "cotacao vigente". */
  pesoGramas?: number | null;
  cep?: string | null;
}

/**
 * Aplica uma opcao da recotacao: grava o frete novo na proposta, move o total
 * pelo delta e registra o ledger. NAO lanca nada na Conta Corrente.
 *
 * `chave` e a idempotencia e nasce por OPCAO, quando o resultado da cotacao
 * chega — nunca no clique. Quem decide e o banco (unique na tabela do ledger):
 * repetir a mesma chave devolve o registro anterior sem gravar de novo.
 */
export async function aplicarRecotacao(input: {
  idInt: number;
  chave: string;
  opcaoId: string;
  valorVisto: number;
  idEnderecoEntrega?: string | null;
}): Promise<AplicacaoRecotacao> {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/aplicar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id_int: input.idInt,
        chave: input.chave,
        opcao_id: input.opcaoId,
        valor_visto: input.valorVisto,
        id_endereco_entrega: input.idEnderecoEntrega ?? null
      })
    });
    const data = (await res.json().catch(() => null)) as (AplicacaoRecotacao & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha ao aplicar (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/** Resultado de liberar ou cancelar a liberacao de recotacao (admin). */
export interface LiberacaoResult {
  success: boolean;
  errorMessage?: string;
  /** true quando o pedido ja estava liberado: nenhuma linha nova foi criada. */
  idempotente?: boolean;
  idLiberacao?: number;
  liberadoPorNome?: string | null;
  liberadoEm?: string | null;
}

async function chamarLiberacao(metodo: "POST" | "DELETE", idInt: number, motivo?: string | null) {
  const token = await tokenSessao();
  if (!token) return { success: false, errorMessage: "Sessão expirada. Faça login novamente." };
  try {
    const res = await fetch("/api/expedicao/recotacao/liberar", {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_int: idInt, motivo: motivo ?? null })
    });
    const data = (await res.json().catch(() => null)) as (LiberacaoResult & { message?: string }) | null;
    if (res.ok && data?.success) return data;
    return { success: false, errorMessage: data?.message || `Falha na operação (HTTP ${res.status}).` };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.message : "Erro de rede." };
  }
}

/**
 * Libera a recotacao de UM pedido. So admin (expedicao.admin).
 *
 * Idempotente: liberar pedido que ja tem liberacao ativa devolve a existente,
 * sem criar segunda linha — quem garante e o indice unico parcial do banco.
 */
export function liberarRecotacao(idInt: number, motivo?: string | null): Promise<LiberacaoResult> {
  return chamarLiberacao("POST", idInt, motivo);
}

/**
 * Cancela a liberacao ATIVA de um pedido. So alcanca liberacao nao consumida:
 * autorizacao ja usada nao se desfaz por aqui.
 */
export function revogarRecotacao(idInt: number, motivo?: string | null): Promise<LiberacaoResult> {
  return chamarLiberacao("DELETE", idInt, motivo);
}

/** A liberacao ATIVA de um pedido, ou null. Le direto da tabela (RLS: select). */
export async function buscarLiberacaoAtiva(
  idInt: number
): Promise<{ id: number; liberadoEm: string; liberadoPorNome: string | null } | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("expedicao_recotacao_liberacoes")
    .select("id, liberado_em, liberado_por_nome")
    .eq("id_int", idInt)
    .is("consumida_em", null)
    .is("revogada_em", null)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: Number(data.id),
    liberadoEm: String(data.liberado_em),
    liberadoPorNome: data.liberado_por_nome ?? null
  };
}

/**
 * Veredito da trava de frete do despacho (regra de 24/09/2026), calculado NO
 * BANCO por `exp_trava_frete_despacho` — a mesma funcao que a trigger de
 * `expedicoes` usa para recusar o despacho. A tela so pergunta; nao decide.
 *
 * Com CEP ou transporte diferentes do cotado, vale a ultima recotacao feita
 * para o CEP de agora: ate R$ 4,00 acima do frete da proposta so avisa, acima
 * trava, e sem recotacao pede para recotar. Liberacao de ADM destrava.
 */
export interface TravaFreteDespacho {
  bloqueia: boolean;
  situacao:
    | "SEM_PROPOSTA"
    | "FORA_DE_CIF"
    | "SEM_COTACAO"
    | "SEM_DIVERGENCIA"
    | "PRECISA_RECOTAR"
    | "DENTRO_DO_LIMITE"
    | "ACIMA_DO_LIMITE"
    | "LIBERADO_ADM";
  mensagem?: string;
  precisa_recotar?: boolean;
  cep_mudou?: boolean;
  transporte_mudou?: boolean;
  frete_proposta?: number;
  valor_recotado?: number;
  diferenca?: number;
  limite?: number;
  opcao?: { transportadora?: string; servico?: string; valor?: number } | null;
  liberacao?: { id: number; liberado_em: string; liberado_por_nome: string | null; motivo: string } | null;
}

/** Null = nao foi possivel avaliar agora (a trava do banco segue valendo no despacho). */
export async function avaliarTravaFreteDespacho(entrada: {
  idInt: number;
  cepDestino: string | null;
  tipoFrete: string | null;
  modalidade: string | null;
}): Promise<TravaFreteDespacho | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.rpc("exp_trava_frete_despacho", {
    p_id_int: entrada.idInt,
    p_cep_destino: entrada.cepDestino,
    p_tipo_frete: entrada.tipoFrete,
    p_modalidade: entrada.modalidade
  });
  if (error || !data) return null;
  return data as TravaFreteDespacho;
}

/** "EXP_LIB_DESP_MOTIVO: informe o motivo" -> "informe o motivo". */
function mensagemDoBanco(texto: string | undefined, padrao: string): string {
  const limpo = String(texto ?? "").replace(/^[A-Z0-9_]+:\s*/, "").trim();
  return limpo || padrao;
}

/**
 * Liberacao do despacho pelo ADM, com qualquer diferenca de frete. A permissao
 * (`expedicao.admin`) e conferida DENTRO da funcao do banco, que grava quem
 * liberou (auth.uid) — o nome enviado aqui e so o rotulo legivel. Uso unico:
 * o despacho a consome.
 */
export async function liberarDespacho(
  idInt: number,
  motivo: string,
  autorNome: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, errorMessage: "Supabase não inicializado." };
  const { error } = await client.rpc("exp_liberar_despacho", {
    p_id_int: idInt,
    p_motivo: motivo,
    p_autor_nome: autorNome
  });
  if (error) return { success: false, errorMessage: mensagemDoBanco(error.message, "Não foi possível liberar o despacho.") };
  return { success: true };
}

export async function revogarDespacho(
  idInt: number,
  autorNome: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, errorMessage: "Supabase não inicializado." };
  const { error } = await client.rpc("exp_revogar_despacho", { p_id_int: idInt, p_autor_nome: autorNome });
  if (error) return { success: false, errorMessage: mensagemDoBanco(error.message, "Não foi possível cancelar a liberação.") };
  return { success: true };
}
