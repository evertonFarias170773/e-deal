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

/** Como formatar o valor, o limite e as faixas. "taxa" = bytes por segundo. */
export type UnidadeSaude = "pct" | "bytes" | "taxa" | "carga" | "contagem";

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
  /** Informação secundária, em uma linha. Não entra no cálculo da cor. */
  detalhe?: string | null;
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
  /**
   * Atividade do swap, em bytes por segundo (páginas que entram + saem × 4 KB).
   * A OCUPAÇÃO do swap não entra na cor: em 02/10/2026 ela marcava 61% com a
   * memória livre em 48%, as leituras pela memória em 100% e zero troca por
   * segundo — o Linux guarda ali páginas paradas e as deixa lá. O que machuca é
   * o servidor trocar dados com o disco o tempo todo. Em 03/10/2026 o acumulado
   * desde o boot era de ~3 milhões de páginas (12 GB) e, entre duas leituras com
   * 15 s de intervalo, não houve nenhuma troca. As faixas são ponto de partida:
   * ajustar conforme o painel mostrar a rotina real.
   */
  swapAtividadeBytesPorSegundo: { amarelo: 100 * 1024, vermelho: 1024 * 1024 },
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

/** Contadores acumulados do kernel (`pswpin`/`pswpout`, em páginas) lidos num instante. */
export type AmostraSwap = { em: number; entrou: number; saiu: number };

const BYTES_POR_PAGINA = 4096;

/**
 * Bytes por segundo trocados entre memória e disco entre duas leituras dos
 * contadores. `null` quando não dá para saber: intervalo zero, ou contador que
 * diminuiu (o servidor reiniciou e zerou).
 */
export function taxaSwapBytesPorSegundo(antes: AmostraSwap, depois: AmostraSwap): number | null {
  const segundos = (depois.em - antes.em) / 1000;
  const entrou = depois.entrou - antes.entrou;
  const saiu = depois.saiu - antes.saiu;
  if (!(segundos > 0) || entrou < 0 || saiu < 0) return null;
  return ((entrou + saiu) * BYTES_POR_PAGINA) / segundos;
}

export function formatarBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Selo de cada cor, como aparece no cartão do painel. O Maestro usa a mesma
 * tabela para dizer "Atenção" ou "Agir agora" com as palavras da tela.
 */
export const ROTULO_DO_NIVEL: Record<NivelSaude, string> = {
  ok: "Tudo certo",
  atencao: "Atenção",
  critico: "Agir agora",
  indisponivel: "Sem leitura"
};

/** A linha de faixas do cartão: "Amarelo acima de X · vermelho acima de Y". */
export function descreverFaixas(m: Pick<MetricaSaude, "sentido" | "amarelo" | "vermelho" | "unidade">): string {
  const palavra = m.sentido === "acima" ? "acima de" : "abaixo de";
  return `Amarelo ${palavra} ${formatarValorSaude(m.amarelo, m.unidade)} · vermelho ${palavra} ${formatarValorSaude(m.vermelho, m.unidade)}`;
}

export function formatarValorSaude(valor: number | null, unidade: UnidadeSaude): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  switch (unidade) {
    case "pct":
      return `${valor.toFixed(1).replace(".", ",")}%`;
    case "bytes":
      return formatarBytes(valor);
    case "taxa":
      return `${formatarBytes(valor)}/s`;
    case "carga":
      return valor.toFixed(2).replace(".", ",");
    default:
      return String(Math.round(valor));
  }
}
