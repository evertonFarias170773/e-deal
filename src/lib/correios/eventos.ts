/**
 * Classificação dos eventos de rastreio dos Correios.
 *
 * POR QUE ISSO EXISTE COMO MÓDULO
 *   As mesmas listas decidem duas coisas em lugares distantes: o receiver do
 *   webhook (`/api/correios/webhook`), que muda `status_interno` sozinho, e a
 *   consulta de rastreio da tela, que libera o botão "marcar ENTREGUE". Duas
 *   cópias de uma lista que autoriza mudança de status é o tipo de divergência
 *   que este projeto já pagou caro (a precedência de peso viveu copiada em
 *   quatro arquivos e divergiu em todos).
 *
 * O par que identifica o evento é `codigo`-`tipo` ("BDE-1", "PO-9"), tanto no
 * payload do webhook quanto no `srorastro`.
 */

/** Postagem/coleta — o objeto saiu. */
export const EVENTOS_EM_TRANSITO = new Set([
  "PO-1",
  "PO-2",
  "PO-9",
  "CO-1",
  "CO-15",
  "CO-16",
  "CMT-0"
]);

/** Entrega ao destinatário (famílias BDE/BDI/BDR, variantes 1/67/68/70). */
export const EVENTOS_ENTREGUE = new Set(
  ["BDE", "BDI", "BDR"].flatMap((familia) => ["1", "67", "68", "70"].map((n) => `${familia}-${n}`))
);

/** "BDE" + "1" → "BDE-1". Vazio quando falta qualquer uma das partes. */
export function chaveEvento(codigo: string | null | undefined, tipo: string | number | null | undefined): string {
  const c = String(codigo ?? "").trim().toUpperCase();
  const t = String(tipo ?? "").trim();
  if (!c || !t) return "";
  // O SRO devolve o tipo com zero à esquerda ("01"); o webhook, sem ("1").
  // Tipo não numérico fica como veio — não existe nas listas e cai fora.
  const n = Number(t);
  return `${c}-${Number.isFinite(n) ? String(n) : t}`;
}

export function eventoEhEntrega(codigo: string | null | undefined, tipo: string | number | null | undefined): boolean {
  return EVENTOS_ENTREGUE.has(chaveEvento(codigo, tipo));
}

export function eventoEhTransito(codigo: string | null | undefined, tipo: string | number | null | undefined): boolean {
  return EVENTOS_EM_TRANSITO.has(chaveEvento(codigo, tipo));
}
