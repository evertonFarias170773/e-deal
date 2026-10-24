import type { Opcao } from "../types";

/** Empresas do grupo, pelo id de `pagamentos_v2.id_empresa` (1, 2 e 3). */
export const OPCOES_EMPRESA: Opcao[] = [
  { valor: "1", rotulo: "Ideal Gráfica" },
  { valor: "2", rotulo: "Ideal Birô" },
  { valor: "3", rotulo: "E3 Brindes" }
];

/**
 * Vendedores cadastrados (usuários marcados como vendedor).
 *
 * O serviço é importado só na hora de uso: a rota de dados também lê as
 * definições e não deve carregar o cliente de navegador do Supabase.
 */
export async function carregarVendedores(): Promise<Opcao[]> {
  const { listVendedoresReais } = await import("@/features/orcamentos/services/orcamentos.service");
  const vendedores = await listVendedoresReais();
  const nomes = new Set<string>();
  for (const v of vendedores) {
    const nome = String(v.nome_usuario ?? "").trim();
    if (nome) nomes.add(nome);
  }
  return [...nomes].map((nome) => ({ valor: nome, rotulo: nome }));
}
