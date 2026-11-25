/**
 * Selo da coluna "Contas a Receber" do Histórico de notas fiscais.
 *
 * Saiu de `NotasFiscaisPage` em 25/11/2026 para ganhar teste, com um estado a
 * mais: `ERRO_LEITURA`. Até ali, uma leitura que falhava (2.079 refs num filtro
 * só, "Bad Request") deixava a contagem vazia e TODA nota aparecia "Sem
 * vencimentos fiscais" — erro de leitura parecendo dado. A ordem dos demais
 * estados é a de antes.
 */
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { estadoDoRegistroBancario } from "@/features/cobrancas/lib/registro-bancario";

export type StatusFinanceiroNfe =
  | "ERRO_LEITURA"
  | "SEM_VENCIMENTOS"
  | "NAO_LANCADO"
  | "DIVERGENCIA"
  | "PARCIAL"
  | "DEPOSITO_CONTA"
  | "BOLETO_EM_PROCESSAMENTO"
  | "BOLETO_REGISTRADO"
  | "A_RECEBER_CRIADO";

export type SeloFinanceiroNfe = {
  status: StatusFinanceiroNfe;
  label: string;
  tone: "neutral" | "danger" | "warning" | "success" | "info";
};

type Boleto = Pick<SupabaseBoletoRow, "valor" | "deposito_conta" | "id_boleto_c6" | "nosso_numero" | "linha_digitavel"> &
  Parameters<typeof estadoDoRegistroBancario>[0];

function preenchido(valor: unknown): boolean {
  return valor !== null && valor !== undefined && valor !== "";
}

export function statusFinanceiroDaNfe(entrada: {
  valorTotalNf: number;
  /** Parcelas fiscais ativas da nota. */
  qtdParcelasAtivas: number | undefined;
  boletos: readonly Boleto[] | undefined;
  /** A leitura das parcelas ou dos títulos falhou: não se sabe nada da nota. */
  leituraFalhou?: boolean;
}): SeloFinanceiroNfe {
  if (entrada.leituraFalhou) {
    return { status: "ERRO_LEITURA", label: "Não foi possível carregar", tone: "warning" };
  }

  if (!entrada.qtdParcelasAtivas) {
    return { status: "SEM_VENCIMENTOS", label: "Sem vencimentos fiscais", tone: "neutral" };
  }

  const boletos = entrada.boletos ?? [];
  if (boletos.length === 0) {
    return { status: "NAO_LANCADO", label: "Não lançado no contas a receber", tone: "danger" };
  }

  const totalValor = boletos.reduce((acc, b) => acc + Number(b.valor || 0), 0);
  const diff = totalValor - entrada.valorTotalNf;

  // Divergência: soma dos boletos maior que o total da NF em mais de 0.05
  if (diff > 0.05) return { status: "DIVERGENCIA", label: "Divergência", tone: "danger" };

  // Parcial: soma menor que o total em mais de 0.05
  if (diff < -0.05) return { status: "PARCIAL", label: "Parcialmente lançado", tone: "warning" };

  // A soma bate (+/- 0.05). Todos depósito em conta?
  if (boletos.every((b) => b.deposito_conta === true)) {
    return { status: "DEPOSITO_CONTA", label: "Depósito em conta", tone: "success" };
  }

  // Para boletos que NÃO são depósito em conta, verificar se estão registrados
  const naoDeposito = boletos.filter((b) => b.deposito_conta !== true);
  const todosRegistrados =
    naoDeposito.length > 0 &&
    naoDeposito.every((b) => preenchido(b.id_boleto_c6) || preenchido(b.nosso_numero) || preenchido(b.linha_digitavel));

  // Todos com registro, mas algum só com o código da cobrança (boleto ainda
  // não emitido): em processamento no banco, não "registrado" (04/11/2026).
  if (todosRegistrados && naoDeposito.some((b) => estadoDoRegistroBancario(b) === "EM_PROCESSAMENTO")) {
    return { status: "BOLETO_EM_PROCESSAMENTO", label: "Boleto em processamento no banco", tone: "info" };
  }

  if (todosRegistrados) return { status: "BOLETO_REGISTRADO", label: "Boleto registrado", tone: "success" };

  // Pelo menos um boleto não-depósito está pendente de registro
  return { status: "A_RECEBER_CRIADO", label: "A receber criado — boleto não registrado", tone: "warning" };
}
