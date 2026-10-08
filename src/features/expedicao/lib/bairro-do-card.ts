import { categoriaExibida, type CategoriaFrete } from "@/features/orcamentos/lib/categoria-frete";

/**
 * O BAIRRO NO CARD DA EXPEDIÇÃO, só nas entregas por MOTOBOY (08/10/2026).
 *
 * Pedido da produção: com o bairro ao lado da cidade, dá para montar as rotas
 * do motoboy do dia sem abrir pedido por pedido.
 *
 * DUAS REGRAS, e só elas:
 *   1. O bairro vem do MESMO endereço de entrega de onde o card já tira a
 *      cidade (`enderecoEntrega`, resolvido no service a partir de `enderecos`).
 *      Nenhuma consulta nova: a coluna `bairro` já era lida para montar o rótulo.
 *   2. "É motoboy" é o MESMO critério da coluna Motoboy do Kanban:
 *      `categoriaExibida(p.categoriaFrete) === "MOTOBOY"`. Não há segunda regra
 *      aqui — se a coluna mudar de critério, o bairro acompanha.
 *
 * Retira, Correios, transportadora e não classificado (EXTRAS) não mostram.
 */

/** Textos que não são bairro: campo vazio ou lixo de cadastro. */
const LIXO = new Set(["NULL", "UNDEFINED", "[OBJECT OBJECT]", "NAN", "-"]);

/** O bairro limpo, ou "" quando não há o que mostrar. Nunca devolve espaço solto. */
export function bairroExibivel(bairro: unknown): string {
  if (typeof bairro !== "string") return "";
  const limpo = bairro.replace(/\s+/g, " ").trim();
  if (!limpo || LIXO.has(limpo.toUpperCase()) || limpo.toUpperCase().includes("[OBJECT OBJECT]")) return "";
  return limpo;
}

/** O envio é por motoboy? O mesmo teste que põe o pedido na coluna Motoboy. */
export function envioPorMotoboy(categoriaFrete: CategoriaFrete | null | undefined): boolean {
  return categoriaExibida(categoriaFrete) === "MOTOBOY";
}

/**
 * O que o card escreve ao lado da cidade: o bairro, ou "" para não escrever nada.
 * O nome vem INTEIRO — quem corta com reticências é o CSS do card, e o `title`
 * mostra o nome completo.
 */
export function bairroDoCard(pedido: {
  categoriaFrete: CategoriaFrete | null | undefined;
  enderecoEntrega: { bairro?: string | null } | null | undefined;
}): string {
  if (!envioPorMotoboy(pedido.categoriaFrete)) return "";
  return bairroExibivel(pedido.enderecoEntrega?.bairro);
}
