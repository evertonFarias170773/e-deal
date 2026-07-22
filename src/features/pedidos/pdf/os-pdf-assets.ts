/**
 * Assets estáticos do PDF da OS (logos por empresa) e resolução do id da empresa
 * a partir do texto livre de propostas.empresa.
 * Sem dependência de fs — a leitura dos arquivos é feita apenas na rota server-side.
 */

export type EmpresaId = 1 | 2 | 3;

/**
 * Arquivos em public/logos/ — copiados da pasta logos/ da raiz (nomes ASCII estáveis).
 * Nota: "logo ideal 2016.jpg" da raiz é na verdade PNG — salvo como empresa-1.png.
 */
export const EMPRESA_LOGO_FILES: Record<EmpresaId, string> = {
  1: "empresa-1.png",
  2: "empresa-2.png",
  3: "empresa-3.jpg"
};

/** Nome de exibição por empresa (fallback quando public.empresas não retornar). */
export const EMPRESA_NOMES: Record<EmpresaId, string> = {
  1: "Ideal Gráfica",
  2: "Ideal Birô",
  3: "E3 Brindes"
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Resolve o texto livre de propostas.empresa ("Ideal Grafica" | "Ideal Biro" | "E3 Brindes",
 * com ou sem acento) para o id 1/2/3. Fallback: 1 (Ideal Gráfica), mesmo default usado
 * em pedidos-detalhe.service.
 */
export function empresaTextoParaId(texto: string | null | undefined): EmpresaId {
  const normalized = normalize(String(texto || ""));
  if (normalized.includes("biro")) return 2;
  if (normalized.includes("e3")) return 3;
  return 1;
}
