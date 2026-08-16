import type { SupabaseClient } from "@supabase/supabase-js";

export type EmpresaRemetente = {
  id: number;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  telefone_nfe: string | null;
};

const COLUNAS =
  "id, razao_social, nome_fantasia, cnpj, cep, logradouro, numero, complemento, bairro, municipio, uf, telefone_nfe";

/**
 * Empresa remetente de um pedido, a partir de `propostas.empresa`.
 *
 * Match por ilike (não eq) porque `propostas.empresa` diverge do cadastro em
 * acentuação e caixa — mesmo critério já usado em etiqueta-viewmodel.service.ts.
 *
 * Vive num módulo próprio porque as credenciais dos Correios são escolhidas pelo
 * `id` devolvido aqui, e as duas rotas precisam resolver IGUAL: o rótulo só pode
 * ser baixado com o cartão de postagem que criou a pré-postagem. Se a rota da
 * etiqueta resolvesse a empresa por outro critério, cairia num cartão diferente
 * e os Correios recusariam o download.
 */
export async function resolverEmpresaRemetente(
  supabase: SupabaseClient,
  nomeEmpresa: string | null | undefined
): Promise<EmpresaRemetente | null> {
  const nome = String(nomeEmpresa ?? "").trim();

  if (nome) {
    const { data } = await supabase
      .from("empresas")
      .select(COLUNAS)
      .or(`empresa.ilike."${nome}",nome_fantasia.ilike."${nome}",razao_social.ilike."${nome}"`)
      .limit(1)
      .maybeSingle();
    if (data) return data as EmpresaRemetente;
  }

  // Sem nome ou sem correspondência: primeira empresa cadastrada, como antes.
  const { data } = await supabase
    .from("empresas")
    .select(COLUNAS)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as EmpresaRemetente) ?? null;
}
