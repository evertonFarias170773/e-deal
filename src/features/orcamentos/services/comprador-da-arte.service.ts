import { getSupabaseClient } from "@/lib/supabase/client";
import { mapSupabaseContatoRowToCadastroContato } from "@/features/cadastros/mappers";
import type { CadastroContato } from "@/features/cadastros/types";
import type { SupabaseContatoRow } from "@/features/cadastros/types.supabase";

/**
 * Leitura e gravação do Comprador da aba Artes (regra em lib/comprador-da-arte).
 *
 * Desde 07/11/2026 o Comprador é o "Contato responsável" da aba Geral: grava
 * `propostas.id_contato` e o nome em `propostas.contato`, como o Salvar da
 * proposta. `id_contato_comprador` (06/11) não é mais lido nem gravado.
 * O contato em si é gravado pelas funções do cadastro.
 */

export type DadosDoCompradorDaArte = {
  contatos: CadastroContato[];
  /** `propostas.id_contato` como está no banco agora. */
  idContatoGravado: string | null;
  statusArte: string | null;
};

export async function carregarCompradorDaArte(
  idInt: number,
  idCliente: string | null
): Promise<{ ok: true; dados: DadosDoCompradorDaArte } | { ok: false; erro: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, erro: "Conexão com o banco indisponível." };

  const [proposta, arte, contatos] = await Promise.all([
    client.from("propostas").select("id_contato").eq("id_int", idInt).maybeSingle(),
    client.from("pedidos_artes").select("status").eq("id_int", idInt).order("created_at", { ascending: false }).limit(1),
    idCliente && /^\d+$/.test(idCliente)
      ? client.from("contatos").select("id, nome_contato, cargo, whats, e_mail, ativo").eq("id_cliente", Number(idCliente)).order("id")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const erro = proposta.error ?? arte.error ?? contatos.error;
  if (erro) return { ok: false, erro: erro.message || "Falha ao ler o Comprador do cliente." };

  const idGravado = String(proposta.data?.id_contato ?? "").trim();
  return {
    ok: true,
    dados: {
      contatos: ((contatos.data ?? []) as SupabaseContatoRow[]).map(mapSupabaseContatoRowToCadastroContato),
      idContatoGravado: idGravado || null,
      statusArte: (arte.data?.[0]?.status as string | null | undefined) ?? null,
    },
  };
}

/** Grava o contato responsável da proposta (o mesmo campo da aba Geral). */
export async function gravarContatoDaProposta(
  idInt: number,
  contato: Pick<CadastroContato, "id" | "nome">
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, erro: "Conexão com o banco indisponível." };
  if (!/^\d+$/.test(contato.id)) return { ok: false, erro: "Contato ainda não gravado no cadastro." };

  const { data, error } = await client
    .from("propostas")
    .update({ id_contato: contato.id, contato: contato.nome.trim() })
    .eq("id_int", idInt)
    // Complemento herda o contato do pedido principal: nunca é regravado aqui.
    .is("id_int_pedido_principal", null)
    .select("id_int");
  if (error) return { ok: false, erro: error.message || "Falha ao gravar o contato na proposta." };
  if (!data || data.length === 0) {
    return { ok: false, erro: "Complemento usa o contato do pedido principal: troque o contato lá." };
  }
  return { ok: true };
}
