/**
 * Saúde da infraestrutura — tipos e limites compartilhados entre a rota
 * `/api/admin/infra-saude` (que calcula) e a seção do Dashboard (que mostra).
 *
 * Os limites de amarelo e vermelho são os do raio-X de 26/09/2026 (projeto no
 * plano Pro, máquina Micro: 1 GB de RAM, 2 núcleos, 60 conexões diretas, disco
 * de 8 GB). Tráfego de saída e cota do plano ficam de fora: exigem o token de
 * gestão da Supabase.
 */

export type NivelSaude = "ok" | "atencao" | "critico" | "indisponivel";

/** Como formatar o valor, o limite e as faixas. */
export type UnidadeSaude = "pct" | "bytes" | "carga" | "contagem";

export type MetricaSaude = {
  chave: string;
  titulo: string;
  /** Uma frase para quem não é da área: o que é e por que importa. */
  explicacao: string;
  unidade: UnidadeSaude;
  /** null quando a leitura falhou. */
  valor: number | null;
  /** Capacidade total, quando existe (ex.: 60 conexões, 100 GB). */
  limite: number | null;
  /** "acima": fica ruim quando sobe. "abaixo": fica ruim quando desce. */
  sentido: "acima" | "abaixo";
  amarelo: number;
  vermelho: number;
  nivel: NivelSaude;
};

export type BucketSaude = {
  bucket: string;
  publico: boolean;
  arquivos: number;
  bytes: number;
  bytes30d: number;
};

export type InfraSaude = {
  geradoEm: string;
  /** Até quando o servidor reaproveita esta leitura. */
  validoAte: string;
  metricas: MetricaSaude[];
  buckets: BucketSaude[];
  historicoMeses: { mes: string; bytes: number }[];
  /** Leituras que falharam, em texto simples. */
  avisos: string[];
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Faixas do raio-X. `null` no limite = sem capacidade fixa. */
export const LIMITES_SAUDE = {
  memoriaLivrePct: { amarelo: 25, vermelho: 10 },
  swapPct: { amarelo: 30, vermelho: 60 },
  /** Fração dos núcleos: 70% e 90% da capacidade. */
  cargaFracao: { amarelo: 0.7, vermelho: 0.9 },
  discoPct: { amarelo: 70, vermelho: 85 },
  /** 40 e 50 de 60 conexões. */
  conexoesFracao: { amarelo: 40 / 60, vermelho: 50 / 60 },
  realtime: { limite: 500, amarelo: 300, vermelho: 450 },
  storage: { limite: 100 * GB, amarelo: 60 * GB, vermelho: 80 * GB },
  storage30d: { amarelo: 5 * GB, vermelho: 10 * GB },
  historicoMes: { amarelo: 150 * MB, vermelho: 300 * MB },
  cacheHitPct: { amarelo: 99, vermelho: 97 }
} as const;

export function avaliarNivel(
  valor: number | null,
  sentido: "acima" | "abaixo",
  amarelo: number,
  vermelho: number
): NivelSaude {
  if (valor === null || !Number.isFinite(valor)) return "indisponivel";
  if (sentido === "acima") {
    if (valor > vermelho) return "critico";
    if (valor > amarelo) return "atencao";
    return "ok";
  }
  if (valor < vermelho) return "critico";
  if (valor < amarelo) return "atencao";
  return "ok";
}

export function formatarBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatarValorSaude(valor: number | null, unidade: UnidadeSaude): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  switch (unidade) {
    case "pct":
      return `${valor.toFixed(1).replace(".", ",")}%`;
    case "bytes":
      return formatarBytes(valor);
    case "carga":
      return valor.toFixed(2).replace(".", ",");
    default:
      return String(Math.round(valor));
  }
}
