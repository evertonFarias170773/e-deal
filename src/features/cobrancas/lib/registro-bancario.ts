/**
 * Em que pé está o registro bancário de um título (`boletos`), lido só das
 * colunas que já existem. Sem migration.
 *
 *   - REGISTRADO: o banco devolveu o boleto (linha digitável ou nosso número).
 *   - EM_PROCESSAMENTO: o banco ACEITOU a cobrança (o código dela está em
 *     `id_boleto_c6`), mas o boleto ainda não veio. Não pode ser registrado de
 *     novo: sairia um segundo boleto real. Caso 24402-A (04/11/2026): o Inter
 *     levou ~20 min para emitir e cada nova tentativa criou outro boleto.
 *   - NAO_REGISTRADO: nada no banco.
 *
 * Regra única da tela (Contas a Receber, Notas fiscais) e da rota de registro.
 */
export type EstadoRegistroBancario = "NAO_REGISTRADO" | "EM_PROCESSAMENTO" | "REGISTRADO";

/** Aceita a linha crua do banco (texto, número ou nulo). */
type ValorDaColuna = unknown;
type TituloComRegistro = {
  id_boleto_c6?: ValorDaColuna;
  nosso_numero?: ValorDaColuna;
  linha_digitavel?: ValorDaColuna;
};

const preenchido = (v: unknown) => String(v ?? "").trim() !== "";

export function estadoDoRegistroBancario(titulo: TituloComRegistro): EstadoRegistroBancario {
  if (preenchido(titulo.linha_digitavel) || preenchido(titulo.nosso_numero)) return "REGISTRADO";
  if (preenchido(titulo.id_boleto_c6)) return "EM_PROCESSAMENTO";
  return "NAO_REGISTRADO";
}

/**
 * O código da cobrança no banco, se a resposta da integração trouxer um.
 * Aceita os nomes que o Inter e o fluxo usam, no topo ou dentro de `data` /
 * `cobranca`. Sem código, `null`.
 */
export function codigoDaCobrancaNaResposta(corpo: unknown): string | null {
  const candidatos = (o: unknown): unknown[] => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    return [r.codigoSolicitacao, r.codigo_solicitacao, r.cod_solicitacao_inter, r.cod_inter, r.id_boleto_c6];
  };
  const r = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : null;
  for (const valor of [...candidatos(r), ...candidatos(r?.data), ...candidatos(r?.cobranca)]) {
    const texto = typeof valor === "string" ? valor.trim() : "";
    if (/^[A-Za-z0-9-]{8,64}$/.test(texto)) return texto;
  }
  return null;
}
