/**
 * O QR do boletim/OS: só o número do pedido.
 *
 * Decisão da gerência (09/10/2026): os setores e a Expedição têm leitor no
 * terminal e leem o QR em vez de digitar o número. O conteúdo é exatamente os
 * dígitos de `propostas.id_int` — sem prefixo, sem link, sem espaço, sem quebra
 * de linha. Antes o QR levava um link (`/pedidos/boletim?id_int=…` ou, com o QR
 * público ligado, `/os?t=<token>`); as vias impressas antes continuam valendo
 * com o QR que têm, e a página `/os` e as rotas `os-qr` não mudaram.
 *
 * O NÚMERO NÃO É SEGREDO E NÃO AUTORIZA NADA. As rotas públicas do QR
 * (`/api/os-qr/*`) seguem exigindo o token opaco; nenhuma aceita o número.
 *
 * Sem imports de propósito: roda na rota e no teste do Node.
 */

/** Os dígitos do pedido, ou null quando não há número válido (sem QR). */
export function conteudoQrDoBoletim(idInt: unknown): string | null {
  const numero = typeof idInt === "number" ? idInt : Number(String(idInt ?? "").trim());
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;
  return String(numero);
}

/**
 * Opções do `qrcode` para o QR impresso (62 pt de lado, ~21,9 mm).
 *
 * - Correção de erros H (30%): até 17 dígitos ainda cabem na versão 1
 *   (21 × 21 módulos), então o nível máximo não custa tamanho — e papel de
 *   chão de fábrica dobra, suja e risca.
 * - Margem 4: a zona de silêncio que a norma pede. Com ela são 29 módulos em
 *   62 pt: módulo de ~0,75 mm, bem acima do mínimo de qualquer leitor. Com o
 *   link antigo o QR era versão 4 ou maior e o módulo ficava perto de 0,6 mm
 *   com margem 1.
 * - `scale` inteiro (e não `width`): cada módulo ocupa um número exato de
 *   pixels, sem borda borrada. O tamanho no papel é do layout, não daqui.
 * - Preto puro sobre branco puro.
 */
export const OPCOES_QR_DO_BOLETIM = {
  errorCorrectionLevel: "H",
  margin: 4,
  scale: 16,
  color: { dark: "#000000", light: "#ffffff" }
} as const;
