/**
 * Telefone brasileiro para exibição: `(51) 99999-9999` ou `(51) 3333-4444`.
 *
 * Fora de 10 ou 11 dígitos devolve o texto como veio — o cadastro aceita coisas
 * como ramal e DDI, e mascarar por força mentiria sobre o que está gravado.
 *
 * Mesma regra que `etiqueta-viewmodel.service.ts` já aplicava no PDF; saiu de lá
 * para cá em 02/09/2026, quando o modal Despachar passou a exibir o telefone do
 * destinatário e as duas telas precisaram concordar sobre a máscara.
 */
export function formatPhoneBR(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return String(bruto ?? "").trim();
}
