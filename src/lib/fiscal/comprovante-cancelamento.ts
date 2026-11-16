/**
 * Nome do arquivo do comprovante de cancelamento da NF-e (XML do evento),
 * no mesmo desenho dos outros documentos: "Cancelamento-NF-e-48597-Pedido-25028.xml".
 * Sem dependências: a rota e a tela usam o mesmo nome.
 */
export function nomeDoComprovanteDeCancelamento(entrada: {
  numero: string | number | null | undefined;
  idInt: number | null | undefined;
  ref: string;
}): string {
  const numero = String(entrada.numero ?? "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  const pedido = Number(entrada.idInt) > 0 ? String(Math.trunc(Number(entrada.idInt))) : "";
  const partes = ["Cancelamento", "NF-e", numero || String(entrada.ref).replace(/[^0-9A-Za-z-]+/g, "")];
  if (pedido) partes.push("Pedido", pedido);
  return `${partes.join("-")}.xml`;
}
