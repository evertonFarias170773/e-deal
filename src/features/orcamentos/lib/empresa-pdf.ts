/**
 * Empresa da proposta -> id aceito pela Edge Function do PDF (1, 2 ou 3).
 *
 * `propostas.empresa` é texto livre e convive com várias grafias: "IDEAL GRÁFICA
 * EXPRESSA EIRELI", "Ideal Grafica", "IDEAL BIRÔ SERV. GRAFICOS", "Ideal Biro",
 * "E3 BRINDES LTDA", "E3 Brindes". A comparação ignora acento e caixa: sem isso
 * "GRÁFICA" e "BIRÔ" não casavam e o "Gerar PDF da proposta" / "Gerar OC"
 * recusavam a proposta como de empresa inválida (23058, 03/10/2026).
 * A Birô vem antes porque o nome dela também fala em "graficos".
 */
export function idEmpresaDoPdf(empresa: string | null | undefined): 1 | 2 | 3 | null {
  const nome = (empresa ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (!nome.trim()) return null;
  if (nome.includes("biro")) return 2;
  if (nome.includes("e3") || nome.includes("brindes")) return 3;
  if (nome.includes("grafica") || nome.includes("ingresso")) return 1;
  return null;
}
