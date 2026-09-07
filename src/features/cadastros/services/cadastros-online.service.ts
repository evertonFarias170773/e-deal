import { getSupabaseClient } from "@/lib/supabase/client";

import { inativarCadastro } from "./cadastros.service";

/**
 * Leitura e decisao da fila do cadastro online.
 *
 * Vai pelo browser com a sessao do atendente, e nao por rota com service_role,
 * porque e assim que o resto do ERP escreve: `authenticated` tem SELECT e UPDATE
 * em `cadastros_online` (policies da migration de 07/09/2026), e a inativacao do
 * cliente reusa `inativarCadastro`, o caminho ja testado.
 *
 * A fila NAO tem restricao de perfil, por decisao do dono: qualquer perfil com
 * sessao ve tudo o que caiu, de qualquer vendedor. O `id_vendedor` fica visivel
 * na tela para que se saiba de qual link veio.
 */

export type CadastroOnlineStatus = "PENDENTE" | "APROVADO" | "RECUSADO";

export type CadastroOnlineItem = {
  id: string;
  criadoEm: string;
  nomeVendedor: string;
  documento: string;
  tipoPessoa: string;
  nome: string;
  fantasia: string;
  email: string;
  whatsapp: string;
  telefoneFixo: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  status: CadastroOnlineStatus;
  aprovadoEm: string;
  /** Nulo quando ninguem decidiu — ou seja, quando a aprovacao foi automatica. */
  aprovadoPor: string | null;
  idClienteGerado: number | null;
  motivoRecusa: string;
  consentimentoEm: string;
  consentimentoVersao: string;
};

type LinhaFila = Record<string, unknown>;

function texto(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

function mapear(linha: LinhaFila): CadastroOnlineItem {
  const idGerado = Number(linha.id_cliente_gerado);
  return {
    id: texto(linha.id),
    criadoEm: texto(linha.criado_em),
    nomeVendedor: texto(linha.nome_vendedor),
    documento: texto(linha.documento),
    tipoPessoa: texto(linha.tipo_pessoa),
    nome: texto(linha.nome),
    fantasia: texto(linha.fantasia),
    email: texto(linha.email),
    whatsapp: texto(linha.whatsapp),
    telefoneFixo: texto(linha.telefone_fixo),
    cep: texto(linha.cep),
    endereco: texto(linha.endereco),
    numero: texto(linha.numero),
    complemento: texto(linha.complemento),
    bairro: texto(linha.bairro),
    cidade: texto(linha.cidade),
    uf: texto(linha.uf),
    status: (texto(linha.status) || "PENDENTE") as CadastroOnlineStatus,
    aprovadoEm: texto(linha.aprovado_em),
    aprovadoPor: linha.aprovado_por ? texto(linha.aprovado_por) : null,
    idClienteGerado: Number.isInteger(idGerado) && idGerado > 0 ? idGerado : null,
    motivoRecusa: texto(linha.motivo_recusa),
    consentimentoEm: texto(linha.consentimento_em),
    consentimentoVersao: texto(linha.consentimento_versao)
  };
}

export async function listarCadastrosOnline(): Promise<{
  itens: CadastroOnlineItem[];
  errorMessage?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { itens: [], errorMessage: "Cliente Supabase indisponível." };
  }

  const { data, error } = await client
    .from("cadastros_online")
    // Literal unico, sem concatenacao: o tipo do supabase-js analisa a STRING do
    // select em tempo de compilacao, e uma expressao montada com `+` vira
    // `GenericStringError` — o retorno perde o formato de linha.
    .select(
      "id,criado_em,nome_vendedor,documento,tipo_pessoa,nome,fantasia,email,whatsapp,telefone_fixo,cep,endereco,numero,complemento,bairro,cidade,uf,status,aprovado_em,aprovado_por,id_cliente_gerado,motivo_recusa,consentimento_em,consentimento_versao"
    )
    .order("criado_em", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[CadastrosOnline] Erro ao listar a fila:", error);
    return { itens: [], errorMessage: error.message || "Não foi possível carregar a fila." };
  }

  return { itens: (data ?? []).map((linha) => mapear(linha as LinhaFila)) };
}

/**
 * Recusa um envio que ainda nao virou cliente.
 *
 * Nao apaga nada: o envio continua na fila, com o motivo. A constraint
 * `cadastros_online_aprovado_coerente` exige `aprovado_em` preenchido em
 * RECUSADO — o campo significa "quando isto foi decidido", nao "quando foi
 * aprovado".
 */
export async function recusarCadastroOnline(
  id: string,
  motivo: string,
  decididoPor: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase indisponível." };
  }

  const { data, error } = await client
    .from("cadastros_online")
    .update({
      status: "RECUSADO",
      aprovado_em: new Date().toISOString(),
      aprovado_por: decididoPor,
      motivo_recusa: motivo.trim() || null
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[CadastrosOnline] Erro ao recusar:", error);
    return { success: false, errorMessage: error.message || "Não foi possível recusar o envio." };
  }
  if (!data) {
    return { success: false, errorMessage: "Envio não encontrado ou sem permissão de escrita." };
  }
  return { success: true };
}

/**
 * Desfaz uma aprovacao automatica.
 *
 * O QUE ISTO FAZ, E NA ORDEM QUE FAZ
 *   1. INATIVA o cliente (`ativo = false`). Nao apaga: DELETE em `clientes`
 *      arrastaria endereco e contato sem FK, e a base ja tem 346 orfaos de uma
 *      operacao dessas.
 *   2. Marca o envio como RECUSADO, com o motivo.
 *
 * A ordem importa: se o passo 2 falhasse depois do 1, sobraria um cliente
 * inativo com a fila dizendo APROVADO — visivel e corrigivel. O contrario
 * deixaria a fila dizendo RECUSADO com o cliente ATIVO na base, que e o estado
 * que engana quem olha.
 *
 * O QUE ISTO NAO DESFAZ — e a tela precisa dizer isso em voz alta:
 *   - o `id_cliente` ja foi consumido da sequence e nao volta;
 *   - o endereco e o contato criados junto CONTINUAM la, pendurados no cliente;
 *   - o registro do envio continua na fila, com o consentimento e a data.
 */
export async function desfazerCadastroOnline(
  id: string,
  idClienteGerado: number,
  motivo: string,
  decididoPor: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
  const inativacao = await inativarCadastro(idClienteGerado);
  if (!inativacao.success) {
    return {
      success: false,
      errorMessage:
        inativacao.errorMessage ||
        `Não foi possível inativar o cliente ${idClienteGerado}. Nada foi alterado na fila.`
    };
  }

  const recusa = await recusarCadastroOnline(id, motivo, decididoPor);
  if (!recusa.success) {
    return {
      success: false,
      errorMessage:
        `O cliente ${idClienteGerado} foi inativado, mas a fila não foi atualizada: ` +
        `${recusa.errorMessage ?? "erro desconhecido"}. Tente de novo para concluir.`
    };
  }

  return { success: true };
}
