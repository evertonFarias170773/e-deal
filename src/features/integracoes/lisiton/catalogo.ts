/**
 * INTEGRAÇÃO LISITON → VIBE: o que a API aceita (27/11/2026, decisão do Everton).
 *
 * Só os 6 produtos de prateleira da Lisiton, cada um com a lista FECHADA de cores
 * como está no Vibe (`producao_cores` do formato de produção do produto):
 *   - 9000, 9003 e 9004: as 20 cores do formato Triband;
 *   - 9002 (Jet Band), 201 e 202: só Branca (o 9002 desde 27/11, só na API).
 * Cor fora da lista é recusada com mensagem clara; as quatro que já apareceram
 * digitadas à mão em pedidos antigos (Azul, Azul Celeste, Roxo, Verde Agua) têm
 * recusa própria, dizendo por quê.
 *
 * A comparação ignora caixa, acento e espaço sobrando, mas o que é gravado é o
 * nome EXATO do Vibe (o seletor da tela compara o texto inteiro).
 */

export const ID_CLIENTE_LISITON = 8469;

export const CORES_TRIBAND = [
  "Amarela Canario",
  "Amarelo Fluor",
  "Azul Claro",
  "Azul Médio",
  "Branca",
  "Creme",
  "Dourada",
  "Laranja Fluor",
  "Lilás",
  "Pink Fluor",
  "Prata",
  "Púrple",
  "Rosa Bebê",
  "Azul Escuro",
  "Verde Flúor",
  "Vermelho Fluor",
  "Verde Claro",
  "Preta - Tarja",
  "Verde Bandeira",
  "Marron"
] as const;

export type ProdutoLisiton = { id: number; nome: string; cores: readonly string[] };

export const PRODUTOS_LISITON: readonly ProdutoLisiton[] = [
  { id: 9000, nome: "Dseg - Triband", cores: CORES_TRIBAND },
  // 27/11/2026: pela API o Jet Band é só Branca (o cadastro do produto não muda).
  { id: 9002, nome: "Dseg - Jet Band", cores: ["Branca"] },
  { id: 9003, nome: "Dseg - Bracelete", cores: CORES_TRIBAND },
  { id: 9004, nome: "Dseg - Pino", cores: CORES_TRIBAND },
  { id: 201, nome: "Pulseira Hospitalar Infantil", cores: ["Branca"] },
  { id: 202, nome: "Pulseira Hospitalar Adulto", cores: ["Branca"] }
];

/** Nomes digitados à mão em pedidos antigos que não existem no Vibe. */
export const CORES_RECUSADAS = ["Azul", "Azul Celeste", "Roxo", "Verde Agua"] as const;

export function normalizarCor(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function produtoLisiton(idProduto: unknown): ProdutoLisiton | null {
  const id = Number(idProduto);
  return PRODUTOS_LISITON.find((p) => p.id === id) ?? null;
}

export type CorResolvida = { ok: true; cor: string } | { ok: false; mensagem: string };

/** A cor enviada, no nome exato do Vibe, ou a recusa com a lista do produto. */
export function resolverCor(produto: ProdutoLisiton, cor: unknown): CorResolvida {
  const alvo = normalizarCor(cor);
  if (!alvo) return { ok: false, mensagem: `Informe a cor do produto ${produto.id} (${produto.nome}).` };
  const achada = produto.cores.find((c) => normalizarCor(c) === alvo);
  if (achada) return { ok: true, cor: achada };
  const lista = produto.cores.join(", ");
  if (produto.cores.length === 1) {
    return {
      ok: false,
      mensagem: `O produto ${produto.id} (${produto.nome}) é só ${produto.cores[0]}: a cor "${String(cor).trim()}" não é aceita.`
    };
  }
  if (CORES_RECUSADAS.some((c) => normalizarCor(c) === alvo)) {
    return {
      ok: false,
      mensagem: `A cor "${String(cor).trim()}" não existe no Vibe para o produto ${produto.id} (${produto.nome}). Cores aceitas: ${lista}.`
    };
  }
  return { ok: false, mensagem: `Cor "${String(cor).trim()}" não aceita para o produto ${produto.id} (${produto.nome}). Cores aceitas: ${lista}.` };
}
