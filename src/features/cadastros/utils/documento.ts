export type DocumentoTipo = "CPF" | "CNPJ";

export function normalizeDocumentDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

export function isValidCpf(value: string) {
  const cpf = normalizeDocumentDigits(value);
  if (cpf.length !== 11 || isRepeatedDigits(cpf)) {
    return false;
  }

  const calcDigit = (base: string, factor: number) => {
    const total = base.split("").reduce((sum, digit) => sum + Number(digit) * factor--, 0);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const firstDigit = calcDigit(cpf.slice(0, 9), 10);
  const secondDigit = calcDigit(cpf.slice(0, 10), 11);

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeDocumentDigits(value);
  if (cnpj.length !== 14 || isRepeatedDigits(cnpj)) {
    return false;
  }

  const calcDigit = (base: string, factors: number[]) => {
    const total = base
      .split("")
      .reduce((sum, digit, index) => sum + Number(digit) * factors[index], 0);
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const firstDigit = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

export function validateDocumentByTipo(value: string, tipo: DocumentoTipo) {
  const digits = normalizeDocumentDigits(value);

  if (tipo === "CPF") {
    if (digits.length !== 11) {
      return {
        isValid: false,
        digits,
        message: "Informe um CPF com 11 digitos."
      };
    }

    if (!isValidCpf(digits)) {
      return {
        isValid: false,
        digits,
        message: "CPF invalido. Revise os digitos informados."
      };
    }

    return { isValid: true, digits };
  }

  if (digits.length !== 14) {
    return {
      isValid: false,
      digits,
      message: "Informe um CNPJ com 14 digitos."
    };
  }

  if (!isValidCnpj(digits)) {
    return {
      isValid: false,
      digits,
      message: "CNPJ invalido. Revise os digitos informados."
    };
  }

  return { isValid: true, digits };
}

export function formatDocumentDigits(value: string) {
  const digits = normalizeDocumentDigits(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }

  return digits;
}
