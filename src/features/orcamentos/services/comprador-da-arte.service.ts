import { getSupabaseClient } from "@/lib/supabase/client";
import { mapSupabaseContatoRowToCadastroContato } from "@/features/cadastros/mappers";
import type { CadastroContato } from "@/features/cadastros/types";
import type { SupabaseContatoRow } from "@/features/cadastros/types.supabase";

/**
 * Leitura e gravação do Comprador da aba Artes (regra em lib/comprador-da-arte).
 * Grava só `propostas.id_contato_comprador`; o contato em si é gravado pelas
 * funções do cadastro (createCadastroContatos / updateCadastroContato).
 */

export type DadosDoCompradorDaArte = {
  contatos: CadastroContato[];
  idGravado: string | null;
  statusArte: string | null;
};

export async function carregarCompradorDaArte(
  idInt: number,
  idCliente: string | null
): Promise<{ ok: true; dados: DadosDoCompradorDaArte } | { ok: false; erro: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, erro: "Conexão com o banco indisponível." };

  const [proposta, arte, contatos] = await Promise.all([
    client.from("propostas").select("id_contato_comprador").eq("id_int", idInt).maybeSingle(),
    client.from("pedidos_artes").select("status").eq("id_int", idInt).order("created_at", { ascending: false }).limit(1),
    idCliente && /^\d+$/.test(idCliente)
      ? client.from("contatos").select("id, nome_contato, cargo, whats, e_mail, ativo").eq("id_cliente", Number(idCliente)).order("id")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const erro = proposta.error ?? arte.error ?? contatos.error;
  if (erro) return { ok: false, erro: erro.message || "Falha ao ler o Comprador do cliente." };

  const idGravado = proposta.data?.id_contato_comprador;
  return {
    ok: true,
    dados: {
      contatos: ((contatos.data ?? []) as SupabaseContatoRow[]).map(mapSupabaseContatoRowToCadastroContato),
      idGravado: idGravado == null ? null : String(idGravado),
      statusArte: (arte.data?.[0]?.status as string | null | undefined) ?? null,
    },
  };
}

export async function gravarCompradorDaProposta(
  idInt: number,
  idContato: string
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, erro: "Conexão com o banco indisponível." };
  if (!/^\d+$/.test(idContato)) return { ok: false, erro: "Contato ainda não gravado no cadastro." };

  const { error } = await client
    .from("propostas")
    .update({ id_contato_comprador: Number(idContato) })
    .eq("id_int", idInt);
  if (error) return { ok: false, erro: error.message || "Falha ao gravar o Comprador na proposta." };
  return { ok: true };
}
