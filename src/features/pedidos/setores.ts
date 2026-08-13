/**
 * Setores de produção (PCP) — fonte única.
 *
 * São os quatro valores que `produtos.setor_pcp` realmente usa. O código antigo
 * ainda oferecia "IMPRESSÃO" e "PVP", que não existem em nenhum produto do
 * cadastro e só serviam para o boletim cair num setor inventado.
 *
 * A ordem é a de exibição: cards, abas e a sequência dos PDFs.
 */
export const SETORES_PCP = ["PVC", "LASER", "FLEXO", "TEXTIL"] as const;

export type SetorPcp = (typeof SETORES_PCP)[number];

/** Setor usado quando o produto não tem `setor_pcp` no cadastro. */
export const SETOR_PADRAO: SetorPcp = "LASER";

/**
 * Normaliza um setor vindo do banco para um dos canônicos.
 * Valores legados ("IMPRESSÃO", "PVP", "Digital", nulo) caem no padrão.
 */
export function normalizarSetor(valor: string | null | undefined): SetorPcp {
  const texto = (valor || "").trim().toUpperCase();
  const encontrado = SETORES_PCP.find((s) => s === texto);
  return encontrado ?? SETOR_PADRAO;
}

/** `true` quando o valor já é um setor canônico — usado para não inventar setor. */
export function ehSetorCanonico(valor: string | null | undefined): boolean {
  const texto = (valor || "").trim().toUpperCase();
  return SETORES_PCP.some((s) => s === texto);
}

/** Ordena setores na ordem de exibição; desconhecidos vão para o fim. */
export function ordenarSetores<T>(itens: T[], setorDe: (item: T) => string | null | undefined): T[] {
  const indice = (valor: string | null | undefined) => {
    const pos = SETORES_PCP.indexOf((valor || "").trim().toUpperCase() as SetorPcp);
    return pos === -1 ? SETORES_PCP.length : pos;
  };
  return [...itens].sort((a, b) => indice(setorDe(a)) - indice(setorDe(b)));
}

// ── Identidade visual ───────────────────────────────────────────────────────

/**
 * Cor de cada setor. É a mesma identidade das abas do boletim, dos chips da
 * lista de OS e do PDF — por isso mora aqui, junto da lista de setores, e não
 * na tela que a usou primeiro.
 */
export const CORES_SETOR: Record<string, { chip: string; borda: string; fundo: string; texto: string }> = {
  PVC: {
    chip: "bg-blue-600 text-white",
    borda: "border-blue-300",
    fundo: "bg-blue-50/40",
    texto: "text-blue-900"
  },
  LASER: {
    chip: "bg-amber-500 text-white",
    borda: "border-amber-300",
    fundo: "bg-amber-50/40",
    texto: "text-amber-900"
  },
  FLEXO: {
    chip: "bg-violet-600 text-white",
    borda: "border-violet-300",
    fundo: "bg-violet-50/40",
    texto: "text-violet-900"
  },
  TEXTIL: {
    chip: "bg-teal-600 text-white",
    borda: "border-teal-300",
    fundo: "bg-teal-50/40",
    texto: "text-teal-900"
  }
};

export function coresDoSetor(setor: string) {
  return CORES_SETOR[setor] ?? CORES_SETOR.LASER;
}

// ── Prazo de produção ───────────────────────────────────────────────────────

/**
 * Extrai o número de dias de um `produtos.prazo`, que é texto livre no cadastro:
 * "3 dias úteis", "1 dia útil", "Prazo de produção 2 dias úteis",
 * "Produção: 1 dia útil + Frete", "3 dias". Pega o primeiro número seguido de
 * "dia"/"dias" — o "+ Frete" no fim não entra, porque não tem número próprio.
 *
 * Sem número reconhecível devolve null, para o chamador decidir o que fazer.
 */
export function diasDoPrazo(prazo: string | null | undefined): number | null {
  const texto = (prazo || "").toLowerCase();
  const match = texto.match(/(\d+)\s*dia/);
  if (!match) return null;
  const dias = Number(match[1]);
  return Number.isFinite(dias) && dias > 0 ? dias : null;
}

/**
 * Data limite de entrega: `base` + `dias` dias úteis (sábado e domingo não
 * contam). Feriados não são considerados — o ERP não tem calendário deles.
 * Devolve no formato `YYYY-MM-DD`, que é o que o input date usa.
 */
export function somarDiasUteis(base: Date, dias: number): string {
  const data = new Date(base.getTime());
  let restantes = Math.max(0, Math.floor(dias));
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const diaDaSemana = data.getDay();
    if (diaDaSemana !== 0 && diaDaSemana !== 6) restantes -= 1;
  }
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Data limite sugerida para os boletins do pedido: o MAIOR prazo entre todos os
 * produtos, contado em dias úteis a partir da abertura do boletim. O pedido só
 * fica pronto quando o produto mais demorado ficar, então todos os setores
 * compartilham a mesma data.
 */
export function prazoLimiteDoPedido(prazos: (string | null | undefined)[], base: Date): string | null {
  const dias = prazos.map(diasDoPrazo).filter((d): d is number => d !== null);
  if (dias.length === 0) return null;
  return somarDiasUteis(base, Math.max(...dias));
}
