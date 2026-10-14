/**
 * NFS-E FATURADA EM CONTAS A RECEBER (14/10/2026).
 *
 * A NF-e faturada ganhava "Lançar no Contas a Receber" no Histórico; a NFS-e
 * não tinha caminho (nota 138, pedido 23733). A NFS-e não tem parcelas fiscais
 * gravadas, então entra pela PORTA DA COBRANÇA: a janela "Preparar boletos"
 * monta as parcelas pela condição da cobrança, como no Registro de Recebíveis,
 * e só usa a nota para a referência e o número.
 *
 * Regras puras aqui; teste em scripts/testes/nfse-contas-a-receber.test.mts.
 */

/** O que a escolha precisa de cada NFS-e do pedido. */
export type NfseCandidata = {
  ref?: string | null;
  status?: string | null;
  ambiente?: string | null;
  numero_nfse?: string | number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Colunas mínimas no SELECT de `notas_servico` para a escolha. */
export const COLUNAS_NFSE_DO_PEDIDO = "ref, status, ambiente, numero_nfse, created_at, updated_at";

const emMilissegundos = (valor: unknown): number => Date.parse(String(valor ?? "")) || 0;

/**
 * A NFS-e que representa o pedido no boleto: AUTORIZADA, de PRODUÇÃO, com
 * número. Entre várias, a mais recente. Mesmo critério da NF-e
 * (`escolherNotaAutorizadaDoPedido`), que vale primeiro quando existe.
 */
export function escolherNfseAutorizadaDoPedido<T extends NfseCandidata>(notas: readonly T[] | null | undefined): T | null {
  const candidatas = (notas ?? []).filter(
    (nota) =>
      String(nota.status ?? "").trim().toUpperCase() === "AUTORIZADA" &&
      String(nota.ambiente ?? "").trim().toLowerCase() === "producao" &&
      String(nota.numero_nfse ?? "").trim() !== "" &&
      String(nota.ref ?? "").trim() !== ""
  );
  if (candidatas.length === 0) return null;
  return [...candidatas].sort((a, b) => {
    const porAtualizacao = emMilissegundos(b.updated_at) - emMilissegundos(a.updated_at);
    return porAtualizacao !== 0 ? porAtualizacao : emMilissegundos(b.created_at) - emMilissegundos(a.created_at);
  })[0];
}

export type AcoesFinanceirasDaNfse = {
  lancar: boolean;
  revisar: boolean;
  verContasAReceber: boolean;
};

/**
 * O que o menu da NFS-e oferece. Mesma condição da NF-e:
 *   - só nota AUTORIZADA de PRODUÇÃO (homologação não vira título);
 *   - "Lançar" só com cobrança faturada EM ABERTO e enquanto os títulos ativos
 *     do pedido não cobrem esse total (lançado em parte, oferece o resto);
 *   - "Revisar" e "Ver contas a receber" quando o pedido já tem título ativo.
 *
 * Os títulos são contados por PEDIDO, não pela ref da nota: com 2 ou mais
 * parcelas a referência é `P…`, que não carrega a ref da NFS-e.
 */
export function acoesFinanceirasDaNfse(entrada: {
  status: string | null | undefined;
  ambiente: string | null | undefined;
  faturadoEmAberto: { qtd: number; soma: number } | null | undefined;
  titulosAtivos: { qtd: number; soma: number } | null | undefined;
}): AcoesFinanceirasDaNfse {
  const nenhuma = { lancar: false, revisar: false, verContasAReceber: false };
  if (String(entrada.status ?? "").trim().toUpperCase() !== "AUTORIZADA") return nenhuma;
  if (String(entrada.ambiente ?? "").trim().toLowerCase() !== "producao") return nenhuma;

  const titulos = entrada.titulosAtivos ?? { qtd: 0, soma: 0 };
  const faturado = entrada.faturadoEmAberto ?? { qtd: 0, soma: 0 };
  const temTitulo = titulos.qtd > 0;
  const faltaLancar = faturado.qtd > 0 && titulos.soma < faturado.soma - 0.05;

  return { lancar: faltaLancar, revisar: temTitulo, verContasAReceber: temTitulo };
}

/**
 * O selo "Contas a Receber" da linha da NFS-e (14/10/2026), pelas mesmas
 * condicoes do menu:
 *   - `pelos_titulos`: ja ha titulo ativo — o selo e o da NF-e, calculado sobre
 *     os titulos do pedido (registrado, a receber criado, parcial...);
 *   - `nao_lancado`: faturado em aberto e nenhum titulo — "Nao lancado no
 *     contas a receber";
 *   - `null`: nada a mostrar (nao faturado, homologacao, nota nao autorizada).
 */
export function seloFinanceiroDaNfse(acoes: AcoesFinanceirasDaNfse): "pelos_titulos" | "nao_lancado" | null {
  if (acoes.revisar) return "pelos_titulos";
  if (acoes.lancar) return "nao_lancado";
  return null;
}
