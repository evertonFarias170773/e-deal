import { competenciaDaData, escolherPercentualDoMes, type PercentualVigente } from "@/features/nfse/lib/percentual-simples";

/**
 * O percentual do Simples (Lei 12.741) da empresa no mês de `agora`, lido de
 * `empresas_percentual_simples` (05/11/2026). Leitura com o cliente que a rota
 * já tem (JWT do usuário: a tabela é legível para authenticated).
 *
 * Falha de leitura NÃO vira "cadastrado": a emissão é recusada do mesmo jeito.
 */
type ClienteDeLeitura = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: unknown) => {
        eq: (coluna: string, valor: unknown) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
      };
    };
  };
};

export async function lerPercentualSimplesVigente(
  cliente: unknown,
  idEmpresa: number | null,
  agora: Date = new Date()
): Promise<PercentualVigente> {
  const competencia = competenciaDaData(agora);
  if (idEmpresa == null || !Number.isFinite(idEmpresa)) return { ok: false, competencia, motivo: "NAO_CADASTRADO" };
  try {
    const { data, error } = await (cliente as ClienteDeLeitura)
      .from("empresas_percentual_simples")
      .select("competencia, percentual")
      .eq("id_empresa", idEmpresa)
      .eq("competencia", competencia);
    if (error) {
      console.error("[NFS-e] Falha ao ler o percentual do Simples:", error.message);
      return { ok: false, competencia, motivo: "LEITURA_FALHOU" };
    }
    return escolherPercentualDoMes((data ?? []) as { competencia: string; percentual: number | string | null }[], competencia);
  } catch (e) {
    console.error("[NFS-e] Exceção ao ler o percentual do Simples:", e);
    return { ok: false, competencia, motivo: "LEITURA_FALHOU" };
  }
}
