export interface SefazRejectionInfo {
  codigo: string;
  titulo: string;
  explicacao: string;
  orientacao: string;
  severidade: "erro_fiscal" | "alerta" | "tecnico";
}

const REJEICOES_MAP: Record<string, Omit<SefazRejectionInfo, "codigo">> = {
  "539": {
    titulo: "Numeração de NF-e já utilizada",
    explicacao: "Já existe uma NF-e transmitida com o mesmo número e série, mas com chave de acesso diferente.",
    orientacao: "Verifique a série e o próximo número fiscal da empresa emissora antes de reenviar. Se necessário, gere uma nova NF-e com numeração válida.",
    severidade: "erro_fiscal"
  },
  "850": {
    titulo: "Data de vencimento da parcela inválida",
    explicacao: "A data de vencimento da parcela não foi informada ou está menor que a parcela anterior.",
    orientacao: "Revise as datas das parcelas na aba Pagamentos. As parcelas precisam estar em ordem crescente.",
    severidade: "erro_fiscal"
  },
  "851": {
    titulo: "Valor das parcelas diferente da fatura",
    explicacao: "A soma das parcelas não confere com o valor líquido da fatura.",
    orientacao: "Revise os valores das parcelas e confirme se a soma bate com o total da nota.",
    severidade: "erro_fiscal"
  },
  "853": {
    titulo: "Cobrança informada indevidamente",
    explicacao: "Foram informados dados de cobrança para uma operação que deveria ser à vista.",
    orientacao: "Revise a forma de pagamento e remova parcelas ou dados de fatura quando a operação for à vista.",
    severidade: "erro_fiscal"
  },
  "865": {
    titulo: "Total dos pagamentos menor que o total da nota",
    explicacao: "A soma dos pagamentos informados é menor que o valor total da NF-e.",
    orientacao: "Revise a aba Pagamentos e ajuste o valor pago para bater com o total da nota.",
    severidade: "erro_fiscal"
  },
  "866": {
    titulo: "Troco ausente ou incorreto",
    explicacao: "O valor informado nos pagamentos é maior que o total da nota, mas o troco não foi informado corretamente.",
    orientacao: "Revise o valor pago e informe o troco correto, ou ajuste o pagamento para bater com o total da nota.",
    severidade: "erro_fiscal"
  },
  "899": {
    titulo: "Meio de pagamento informado incorretamente",
    explicacao: "A forma de pagamento enviada não é aceita ou está incompatível com a operação.",
    orientacao: "Revise a forma de pagamento selecionada na aba Pagamentos.",
    severidade: "erro_fiscal"
  },
  "900": {
    titulo: "Data de vencimento menor que a emissão",
    explicacao: "A data de vencimento da parcela não foi informada ou é menor que a data de emissão da NF-e.",
    orientacao: "Revise a data de vencimento das parcelas. Ela deve ser igual ou posterior à data de emissão.",
    severidade: "erro_fiscal"
  },
  "904": {
    titulo: "Valor de pagamento informado indevidamente",
    explicacao: "A NF-e foi enviada com valor de pagamento em uma forma que não permite esse campo.",
    orientacao: "Revise a forma de pagamento. Se a forma for '90 - Sem pagamento', não informe valor de pagamento.",
    severidade: "erro_fiscal"
  }
};

export function getSefazRejectionInfo(codigo?: string | null): SefazRejectionInfo {
  const cleanCode = codigo ? String(codigo).trim() : "";
  const mapped = REJEICOES_MAP[cleanCode];

  if (mapped) {
    return {
      codigo: cleanCode,
      ...mapped
    };
  }

  return {
    codigo: cleanCode,
    titulo: "NF-e rejeitada pela SEFAZ",
    explicacao: "A SEFAZ rejeitou a NF-e com uma mensagem técnica.",
    orientacao: "Revise os dados fiscais e cadastrais conforme a mensagem retornada.",
    severidade: "erro_fiscal"
  };
}
