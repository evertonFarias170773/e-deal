/**
 * Quem pode editar proposta paga ou faturada a vencer, conferido no servidor.
 *
 * Saiu de `/api/orcamentos/editar-paga` em 03/11/2026, sem mudar a lógica, para
 * que o valor negociado do frete (aba Fretes) exija EXATAMENTE a mesma
 * permissão quando ajusta a cobrança faturada. Uma regra, dois chamadores.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PERMISSOES_FALLBACK_ADMIN: string[] = [
  "propostas.editar_paga", "propostas.editar_faturado", "financeiro.resolver_credito",
  "financeiro.bonificar", "financeiro.devolver", "financeiro.debito_futuro", "credito.usar"
];

/**
 * Permissões que abrem a edição, por caminho. `propostas.editar_faturado` vale
 * SÓ no caminho do faturado a vencer (dinheiro ainda não recebido) — quem tem
 * apenas ela continua sem poder editar proposta paga de verdade.
 */
export const PERMISSAO_PROPOSTA_PAGA = "propostas.editar_paga";
export const PERMISSAO_FATURADO = "propostas.editar_faturado";

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário tem alguma das permissões que abrem a edição.
 * `permissoesAceitas` muda conforme o caminho: paga de verdade aceita só
 * `propostas.editar_paga`; faturado a vencer aceita as duas.
 */
export async function verificarPermissaoEditarPaga(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  permissoesAceitas: string[]
): Promise<{ autorizado: boolean; motivo?: string }> {
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (usuarioError || !usuarioData) {
    return { autorizado: false, motivo: "Usuário não encontrado em public.usuarios." };
  }

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) {
    return { autorizado: true };
  }

  if (row.id_perfil != null) {
    const { data: perfilData, error: perfilError } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfilError && perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      if (permissoes.includes("*") || permissoesAceitas.some((p) => permissoes.includes(p))) {
        return { autorizado: true };
      }
      return { autorizado: false, motivo: `Perfil sem permissão ${permissoesAceitas.join(" ou ")}.` };
    }
  }

  if (row.is_admin) {
    const temPermissao = permissoesAceitas.some((p) => PERMISSOES_FALLBACK_ADMIN.includes(p));
    return { autorizado: temPermissao };
  }

  return { autorizado: false, motivo: "Sem permissão para editar proposta paga." };
}
