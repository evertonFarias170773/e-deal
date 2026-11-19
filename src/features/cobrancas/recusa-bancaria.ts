/**
 * Leitura da recusa que o banco devolve ao cancelamento de um título.
 *
 * Regras puras, sem I/O — o servidor decide com elas. Até 26/08/2026 essa
 * leitura vivia no CLIENTE (`nfe.service.ts`), alcançada só pelo caminho legado
 * do C6, e o servidor nunca via a recusa.
 *
 * A distinção que este módulo existe para fazer é a mais perigosa do fluxo:
 *
 *   "título já saiu de circulação"  ≠  "deu erro ao cancelar"
 *
 * Tratar erro como inatividade cancelaria no ERP um título que segue VIVO no
 * banco — o cliente continuaria podendo pagar um boleto que o sistema dá por
 * morto. Por isso o padrão é NÃO reconhecer: só as redações conhecidas contam.
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import { bancoDoBoletoEmitido } from "@/features/cobrancas/lib/banco-boleto-biro";

/** Provedor que emitiu a recusa, pela empresa recebedora. */
export type ProvedorTitulo = "C6" | "INTER";

/**
 * Banco do título. Ideal e E3: C6. Birô: pelo FORMATO do código do título
 * (19/11/2026, Birô no C6); sem código, Inter, como antes.
 */
export function provedorDaEmpresa(idEmpresa: number | null | undefined, codigo?: string | null): ProvedorTitulo {
  return bancoDoBoletoEmitido(idEmpresa, codigo);
}

/**
 * Redações observadas em produção, por provedor.
 *
 * - **C6**: manda sem acentos ("Titulo esta em situacao que nao permite"). A
 *   variante acentuada entra ao lado por segurança, caso o banco reescreva.
 * - **Inter**: outra frase inteiramente — "A cobrança não pode ser cancelada,
 *   pois se encontra na situação EXPIRADO." Observadas `EXPIRADO` e
 *   `CANCELADO` (execuções 116098 e 115001, 14 e 18/08/2026).
 *
 * O predicado do cliente só conhecia a do C6 — não reconheceria a do Inter.
 */
const PADROES_TITULO_INATIVO: readonly string[] = [
  // C6
  "situacao que nao permite",
  "situação que não permite",
  // C6, título JÁ CANCELADO no banco (observada em 19/11/2026, faturado da Birô 24075):
  // "[BoletoClient]: Cannot update boleto:(number=...) with status CANCELLED." Acontece
  // quando o banco cancelou mas o ERP não deu a baixa. A rota ainda confirma no C6 que
  // não houve pagamento antes do cancelamento local.
  "with status cancelled",
  // Inter
  "se encontra na situacao",
  "se encontra na situação"
];

/** A recusa diz que o título já não está ativo no banco? */
export function ehRecusaPorTituloInativo(motivo: string | null | undefined): boolean {
  const texto = String(motivo || "").toLowerCase();
  if (!texto.trim()) return false;
  return PADROES_TITULO_INATIVO.some((padrao) => texto.includes(padrao));
}

/**
 * A situação que o banco informou (`EXPIRADO`, `BAIXADO`, `CANCELADO`…), quando
 * a mensagem a nomeia. O C6 não nomeia; o Inter sim.
 *
 * Serve para o REGISTRO, não para a decisão: o motivo gravado tem de dizer o
 * que o banco respondeu, em vez de fingir que houve cancelamento bancário.
 */
export function situacaoInformadaPeloBanco(motivo: string | null | undefined): string | null {
  const texto = String(motivo || "");
  const m = texto.match(/se encontra na situa[çc][ãa]o\s+([A-ZÀ-Ú_]+)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

/** Texto gravado no histórico da proposta. Nunca afirma cancelamento no banco. */
export function motivoCancelamentoLocal(motivo: string | null | undefined): string {
  const situacao = situacaoInformadaPeloBanco(motivo);
  const base = situacao
    ? `O banco recusou o cancelamento porque o título já está na situação ${situacao}.`
    : "O banco recusou o cancelamento porque o título já não está ativo.";
  return (
    `${base} Confirmado no banco que NÃO houve pagamento. ` +
    "O título foi cancelado apenas no ERP — não houve cancelamento bancário."
  );
}
