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

/**
 * "BDE-01" -> ["BDE", "01"]. O webhook recebe o par JÁ COLADO (no header
 * `x-correios-hook-event`, no `tpEvento` do corpo ou pela regex do corpo cru),
 * enquanto o SRO entrega `codigo` e `tipo` separados. Separar aqui é o que
 * deixa os dois caminhos entrarem pelas mesmas `eventoEhEntrega`/`eventoEhTransito`,
 * em vez de o receiver comparar a string crua contra as listas — que é como
 * "BDE-01" deixava de ser reconhecido como entrega.
 *
 * Corta no ÚLTIMO hífen: nenhum código dos Correios tem hífen, mas se um dia
 * tiver, o número continua sendo o que vem depois do último.
 */
export function separarTipoEvento(tipoColado: string | null | undefined): [string, string] {
  const bruto = String(tipoColado ?? "").trim();
  const corte = bruto.lastIndexOf("-");
  if (corte <= 0) return [bruto, ""];
  return [bruto.slice(0, corte), bruto.slice(corte + 1)];
}

export function eventoEhEntrega(codigo: string | null | undefined, tipo: string | number | null | undefined): boolean {
  return EVENTOS_ENTREGUE.has(chaveEvento(codigo, tipo));
}

export function eventoEhTransito(codigo: string | null | undefined, tipo: string | number | null | undefined): boolean {
  return EVENTOS_EM_TRANSITO.has(chaveEvento(codigo, tipo));
}
