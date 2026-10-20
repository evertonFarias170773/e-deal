import type { TipoFreteNormalizado } from "../types";

/**
 * Status para onde o despacho leva o pedido.
 *
 * TRÊS SAÍDAS DESDE 02/09/2026 (Etapa 7).
 *
 *   RETIRADA                  → `A RETIRAR`, byte a byte como antes;
 *   TRANSPORTADORA / MOTOBOY  → NÃO TRANSICIONA. O pedido segue em
 *                               `EXPEDICAO`, agora com `data_despacho`
 *                               preenchida e `coletado_em` nula — é o estado
 *                               derivado "aguardando coleta". O volume está
 *                               rotulado, na casa, esperando o carro; dizer
 *                               `EM TRANSITO` ali era mentira, ninguém
 *                               transportou nada ainda. `confirmarColeta`
 *                               fecha o passo;
 *   demais (CORREIOS, e o que sobrar) → `EM TRANSITO`, como sempre. A
 *                               postagem É a coleta.
 *
 * `null` = sem transição. Não há status novo: `EXPEDICAO` é o mesmo de
 * sempre, e as dez funções do banco que conhecem o vocabulário não mudam.
 *
 * Extraída de `despachar()` em 14/09/2026 (PEDIDO COMPLEMENTAR, E9): o
 * despacho conjunto leva o complemento para o MESMO destino do principal, e a
 * regra precisa ser uma só para os dois.
 */
/**
 * Despachar DE NOVO um pedido de MOTOBOY ou TRANSPORTADORA que esta em EXPEDICAO comeca um
 * novo ciclo de coleta: o `coletado_em` de um ciclo anterior nao pode sobreviver a ele
 * (pedido 23604: devolvido a EXPEDICAO por escrita direta, que nao limpa a coleta, o
 * `aguardandoColeta` ficava falso e o card oferecia "Despachar" a cada clique).
 *
 * So vale na gravacao do despacho (`despachar()`), com o status LIDO DO BANCO em EXPEDICAO:
 *   - pedido EM TRANSITO/ENTREGUE (aba velha aberta): a coleta e valida e fica;
 *   - CORREIOS: a postagem e a coleta, nada a limpar;
 *   - primeiro despacho / coleta ja vazia: gravar `null` por cima de `null` nao muda nada.
 * "Editar dados", salvar o conhecimento e "Confirmar coleta" nao passam por aqui.
 */
export function deveLimparColetaNoDespacho(entrada: {
  tipoEntrega: "TRANSPORTE" | "RETIRADA";
  tipoFrete: TipoFreteNormalizado;
  statusAtual: string | null | undefined;
}): boolean {
  return (
    entrada.tipoEntrega === "TRANSPORTE" &&
    (entrada.tipoFrete === "TRANSPORTADORA" || entrada.tipoFrete === "MOTOBOY") &&
    String(entrada.statusAtual ?? "").trim().toUpperCase() === "EXPEDICAO"
  );
}

export function destinoDoDespacho(
  tipoEntrega: "TRANSPORTE" | "RETIRADA",
  tipoFrete: TipoFreteNormalizado
): string | null {
  if (tipoEntrega === "RETIRADA") return "A RETIRAR";
  if (tipoFrete === "TRANSPORTADORA" || tipoFrete === "MOTOBOY") return null;
  return "EM TRANSITO";
}
