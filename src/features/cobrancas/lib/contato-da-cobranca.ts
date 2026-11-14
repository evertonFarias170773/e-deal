import type { SupabaseClient } from "@supabase/supabase-js";
import { telefoneParaApi } from "@/lib/telefone/telefone-br";

/**
 * E-MAIL E TELEFONE QUE A COBRANÇA MANDA PARA FORA (14/11/2026, decisão da diretoria).
 *
 * E-MAIL (boleto à vista e a checagem antes do boleto): o do CADASTRO DO PAGADOR
 * (`propostas.id_faturado`, senão o cliente), na mesma ordem da NF-e
 * (fn_montar_payload_nfe: e-mail financeiro, depois e-mail) e por último o
 * e-mail de contato. Só campos de `clientes`; nunca a tabela `contatos`.
 *
 * TELEFONE (PIX e boleto à vista): o da conversa PRINCIPAL do ChatGuru escolhida
 * no pedido (`propostas_contatos_chatguru`), passado por `telefoneParaApi`, que
 * põe o 9 no celular de 8 dígitos e deixa o fixo como está. Pedido antigo sem
 * conversa escolhida segue com o telefone de antes (o do contato da proposta ou
 * o do cliente), pela mesma função.
 */

export const MENSAGEM_PAGADOR_SEM_EMAIL =
  "Pagador sem e-mail no cadastro (e-mail financeiro, e-mail ou e-mail de contato). Preencha o cadastro do cliente para gerar o boleto.";

export type CadastroComEmail = {
  email_financeiro?: string | null;
  email?: string | null;
  email_contato?: string | null;
};

/** Financeiro, depois e-mail, depois e-mail de contato. "" quando nenhum está preenchido. */
export function emailDoPagador(cadastro: CadastroComEmail | null | undefined): string {
  if (!cadastro) return "";
  for (const valor of [cadastro.email_financeiro, cadastro.email, cadastro.email_contato]) {
    const texto = String(valor ?? "").trim();
    if (texto) return texto;
  }
  return "";
}

export type ContatoDaCobranca = {
  email: string;
  telefone: string;
  /** De onde veio o telefone: a conversa principal do Guru ou o caminho antigo. */
  origemTelefone: "CHATGURU" | "ANTIGO" | null;
};

/** O telefone das APIs: o da principal do Guru, ou o de antes (pedido sem escolha). */
export function telefoneDaCobranca(telefoneDoGuru: string | null | undefined, telefoneAntigo: string | null | undefined) {
  const doGuru = telefoneParaApi(telefoneDoGuru);
  if (doGuru) return { telefone: doGuru, origemTelefone: "CHATGURU" as const };
  const antigo = telefoneParaApi(telefoneAntigo);
  if (antigo) return { telefone: antigo, origemTelefone: "ANTIGO" as const };
  // Número fora do padrão: vai como estava (só dígitos), o banco decide.
  const cru = String(telefoneAntigo ?? "").replace(/\D/g, "");
  return { telefone: cru, origemTelefone: cru ? ("ANTIGO" as const) : null };
}

/**
 * Lê, com a sessão de quem gera a cobrança, o pagador da proposta e a conversa
 * principal. `telefoneAntigo` é o que a tela usava antes (contato da proposta ou
 * cliente), só para pedido sem conversa escolhida. Falha de leitura lança: gerar
 * cobrança sem saber o e-mail do pagador diria "sem e-mail" sem ser verdade.
 */
export async function lerContatoDaCobranca(
  client: Pick<SupabaseClient, "from">,
  idInt: number,
  telefoneAntigo: string | null | undefined
): Promise<ContatoDaCobranca> {
  const { data: proposta, error: erroProposta } = await client
    .from("propostas")
    .select("id_cliente, id_faturado")
    .eq("id_int", idInt)
    .maybeSingle();
  if (erroProposta || !proposta) throw new Error("Não foi possível ler o pagador da proposta. Tente de novo.");
  const linha = proposta as { id_cliente: number | null; id_faturado: number | null };
  const idPagador = linha.id_faturado ?? linha.id_cliente;

  let email = "";
  if (idPagador !== null && idPagador !== undefined) {
    const { data: cadastro, error: erroCadastro } = await client
      .from("clientes")
      .select("email_financeiro, email, email_contato")
      .eq("id_cliente", idPagador)
      .maybeSingle();
    if (erroCadastro) throw new Error("Não foi possível ler o e-mail do pagador. Tente de novo.");
    email = emailDoPagador(cadastro as CadastroComEmail | null);
  }

  const { data: principal, error: erroPrincipal } = await client
    .from("propostas_contatos_chatguru")
    .select("telefone")
    .eq("id_int", idInt)
    .eq("principal", true)
    .maybeSingle();
  if (erroPrincipal) throw new Error("Não foi possível ler o contato do pedido no ChatGuru. Tente de novo.");

  return { email, ...telefoneDaCobranca((principal as { telefone: string | null } | null)?.telefone, telefoneAntigo) };
}
