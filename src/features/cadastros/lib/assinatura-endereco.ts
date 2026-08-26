/**
 * A linha de rastro gravada em `enderecos.obs`.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   `enderecos` NAO e auditada — nao esta em `audit.config_v2`, diferente de
 *   `clientes`, `propostas` e `pagamentos_v2`. Quando o sistema sobrescreve uma
 *   linha de endereco, esta assinatura e o UNICO rastro que sobra em qualquer
 *   lugar. A falta desse rastro foi o que tornou o bug do endereco orfao
 *   (26/08/2026) tao dificil de enxergar: o endereco errado nao tinha historia.
 *
 *   Sao dois os pontos que sobrescrevem, e os dois usam o mesmo formato:
 *     - a reconsulta de CNPJ, num cadastro que ja existe;
 *     - a criacao de cadastro, quando o `id_cliente` escolhido ja tinha um
 *       endereco principal (herdado da importacao).
 */

/** Um motivo por ponto que sobrescreve. Texto curto: cabe na tela do cadastro. */
export const MOTIVO_RECONSULTA_CNPJ = "reconsulta do CNPJ";
export const MOTIVO_CRIACAO_CADASTRO = "criacao do cadastro";

/**
 * `Endereco principal atualizado pela <motivo> em <data> <hora> por <autor>.`
 *
 * A data e formatada no fuso de quem chama. Nao ha ISO aqui de proposito: esta
 * linha e lida por gente, na tela do cadastro, nao por maquina.
 */
export function montarAssinaturaEndereco(
  motivo: string,
  autor: string,
  quandoIso: string
): string {
  const quando = new Date(quandoIso);
  const carimbo = Number.isNaN(quando.getTime())
    ? quandoIso
    : `${quando.toLocaleDateString("pt-BR")} ${quando.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      })}`;
  const quem = autor.trim() || "usuario nao identificado";
  return `Endereco principal atualizado pela ${motivo} em ${carimbo} por ${quem}.`;
}
