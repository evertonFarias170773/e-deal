/**
 * SALVAR PROPOSTA COM NF-e DE VENDA VIVA (02/11/2026) — a regra, em um lugar so.
 *
 * POR QUE EXISTE
 *   A NF-e leva valor, desconto e frete do momento do Faturar, e o pedido segue
 *   editavel (a nota antecipada sai ate antes do pagamento). Mudar o pedido depois
 *   nao muda a nota: o 24221 ficou com nota de R$ 285,37 e pedido de R$ 164,56.
 *
 * A REGRA (so aviso, nunca bloqueio)
 *   Ao salvar, se o pedido tem NF-e de VENDA viva (autorizada de producao, em
 *   processamento ou pronta para envio) e o total, o desconto ou o frete mudam
 *   nesta gravacao, a tela pergunta, citando a nota. "Salvar mesmo assim" grava e
 *   registra na linha do tempo; "Voltar" nao grava nada.
 *   As notas vem do BANCO, pela rota do servidor; nunca do que a tela tem.
 */

export const STATUS_NFE_VIVA: readonly string[] = ["AUTORIZADA", "PROCESSANDO", "PRONTA_PARA_ENVIO"];

export type NotaDoBanco = {
  ref: string | null;
  numero_nf: string | number | null;
  status: string | null;
  tipo_nota: string | null;
  ambiente: string | null;
  valor_total_nf: number | string | null;
};

export type NotaViva = { ref: string; numero: string | null; status: string; valor: number };

const normalizar = (s: unknown) => String(s ?? "").trim().toUpperCase();

/**
 * NF-e de venda viva. Remessa nao e venda. Autorizada so conta em PRODUCAO (a de
 * homologacao e teste); em processamento e pronta para envio contam sempre, porque
 * o ambiente so e sincronizado na hora de transmitir.
 */
export function notasDeVendaVivas(notas: readonly NotaDoBanco[]): NotaViva[] {
  return notas
    .filter((n) => normalizar(n.tipo_nota) !== "REMESSA")
    .filter((n) => STATUS_NFE_VIVA.includes(normalizar(n.status)))
    .filter((n) => normalizar(n.status) !== "AUTORIZADA" || normalizar(n.ambiente) === "PRODUCAO")
    .map((n) => ({
      ref: String(n.ref ?? ""),
      numero: n.numero_nf === null || n.numero_nf === undefined || String(n.numero_nf).trim() === "" ? null : String(n.numero_nf).trim(),
      status: normalizar(n.status),
      valor: Math.round((Number(n.valor_total_nf) || 0) * 100) / 100
    }));
}

export type ValoresDoPedido = { total: number; desconto: number; frete: number };

const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

/** Total, desconto ou frete mudam nesta gravacao? (comparacao em centavos) */
export function valoresMudaram(antes: ValoresDoPedido, depois: ValoresDoPedido): boolean {
  return (
    centavos(antes.total) !== centavos(depois.total) ||
    centavos(antes.desconto) !== centavos(depois.desconto) ||
    centavos(antes.frete) !== centavos(depois.frete)
  );
}

export function deveAvisarNotaDivergente(notas: readonly NotaViva[], antes: ValoresDoPedido, depois: ValoresDoPedido): boolean {
  return notas.length > 0 && valoresMudaram(antes, depois);
}

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "NF-e 41170 (R$ 285,37)" ou, sem numero ainda, "NFE-24221-001 (R$ 285,37, PROCESSANDO)". */
export function rotuloDaNotaViva(n: NotaViva): string {
  return n.numero ? `NF-e ${n.numero} (${brl(n.valor)})` : `${n.ref} (${brl(n.valor)}, ${n.status})`;
}

/** Texto da linha do tempo, montado no SERVIDOR com o que o banco diz depois de salvar. */
export function textoLinhaDoTempoNotaDivergente(autor: string, notas: readonly NotaViva[], totalDoPedido: number): string {
  return (
    `⚠️ Pedido salvo por ${autor} com valor diferente da NF-e: pedido ${brl(totalDoPedido)}; ` +
    `${notas.map(rotuloDaNotaViva).join(", ")}. A nota não foi alterada.`
  );
}

export { brl as formatarReais };
