/**
 * Validação estrutural de telefone brasileiro.
 *
 * ESPELHO da regra que roda no n8n (workflow `CARTAO C6 - IDEAL - E3`,
 * id `rxCDH6IwnG06guBD`, nós `Normaliza Ideal C6` e `Normaliza Ideal C`).
 * Mudou aqui, muda lá — e vice-versa.
 *
 * Por que existe em dois lugares: o n8n é a última linha de defesa e revalida
 * tudo, porque o checkout também é aberto fora do ERP (link público reaberto
 * dias depois, cadastro alterado no meio do caminho). Este módulo existe só
 * para avisar o vendedor ANTES de criar a cobrança, quando ainda dá para
 * corrigir sem o cliente esbarrar no erro na tela do banco.
 *
 * Contexto: o C6 valida `payer.phone_number` com `^[0-9]{1,11}$` e passou a
 * recusar string vazia em 03/08/2026. Pior: os campos do pagador ficam
 * BLOQUEADOS no checkout do banco, então número errado trava o cliente sem
 * possibilidade de correção por ele.
 */

/** Faixa de DDD atribuível no Brasil. */
const DDD_MIN = 11;
const DDD_MAX = 99;

export function soDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

export type OpcoesTelefone = {
  /**
   * Recusa telefone fixo. Usar nos fluxos de CARTÃO: o campo do checkout do
   * provedor é "Celular" e rejeita fixo na tela — mesmo o fixo passando no
   * regex da API (`^[0-9]{1,11}$`), o cliente fica travado sem poder corrigir.
   * Comprovado em 06/08/2026: `51 37192870` (fixo válido) gerou checkout e a
   * tela do C6 marcou "Celular inválido".
   */
  somenteCelular?: boolean;
};

/**
 * Celular: 11 dígitos, DDD 11-99 e nono dígito obrigatório na 3ª posição.
 * Fixo: 10 dígitos, DDD 11-99 e prefixo entre 2 e 5 — aceito só quando
 * `somenteCelular` não é exigido.
 */
export function telefoneBRValido(digitos: string, opcoes?: OpcoesTelefone): boolean {
  if (digitos.length !== 10 && digitos.length !== 11) return false;

  const ddd = Number(digitos.slice(0, 2));
  if (!(ddd >= DDD_MIN && ddd <= DDD_MAX)) return false;

  if (digitos.length === 11) return digitos[2] === "9";
  if (opcoes?.somenteCelular) return false;
  return digitos[2] >= "2" && digitos[2] <= "5";
}

/**
 * Devolve o número pronto para o provedor, ou string vazia quando não há
 * número confiável. Nunca completa dígito que falta — um celular sem o nono
 * dígito é recusado, não "consertado": só o cliente sabe o número certo.
 */
export function normalizarTelefoneBR(valor: unknown, opcoes?: OpcoesTelefone): string {
  const digitos = soDigitos(valor);
  if (!digitos) return "";

  // 1) Como está cadastrado tem precedência: já sendo válido, nada é removido.
  if (telefoneBRValido(digitos, opcoes)) return digitos;

  // 2) DDI 55 só sai quando o que sobra é estruturalmente válido.
  if (digitos.startsWith("55")) {
    const semDDI = digitos.slice(2);
    if (telefoneBRValido(semDDI, opcoes)) return semDDI;
  }

  return "";
}

export type FontesTelefonePagador = {
  /** Contato gravado na própria cobrança (`pagamentos_v2.whats_contato`). */
  whatsContato?: string | null;
  whatsapp1?: string | null;
  whatsapp2?: string | null;
  telefoneFixo?: string | null;
};

export type TelefonePagadorResolvido = {
  /** Número normalizado, ou "" quando nenhuma fonte serve. */
  telefone: string;
  /** Rótulo da fonte aproveitada, para exibição. */
  origem: string | null;
  valido: boolean;
};

/**
 * Mesma cadeia e mesma ordem do n8n: contato da cobrança → WhatsApp 1 →
 * WhatsApp 2 → telefone fixo, ficando com a PRIMEIRA fonte que resulta válida
 * (e não com a primeira preenchida).
 */
export function resolverTelefonePagador(
  fontes: FontesTelefonePagador,
  opcoes?: OpcoesTelefone
): TelefonePagadorResolvido {
  const candidatos: Array<{ origem: string; valor: string | null | undefined }> = [
    { origem: "Contato da cobrança", valor: fontes.whatsContato },
    { origem: "WhatsApp 1", valor: fontes.whatsapp1 },
    { origem: "WhatsApp 2", valor: fontes.whatsapp2 },
    { origem: "Telefone fixo", valor: fontes.telefoneFixo }
  ];

  for (const candidato of candidatos) {
    const telefone = normalizarTelefoneBR(candidato.valor, opcoes);
    if (telefone) return { telefone, origem: candidato.origem, valido: true };
  }

  return { telefone: "", origem: null, valido: false };
}

/**
 * Explica em uma frase por que o número não serve. É o texto que o vendedor lê
 * no modal — precisa dizer o que está errado, não só que está errado.
 * Devolve null quando o número é válido.
 */
export function diagnosticarTelefone(valor: unknown, opcoes?: OpcoesTelefone): string | null {
  const digitos = soDigitos(valor);

  if (!digitos) {
    const texto = String(valor ?? "").trim();
    // Cadastro antigo às vezes traz nome ou texto no campo de telefone.
    return texto ? "não tem números" : "não preenchido";
  }
  if (telefoneBRValido(digitos, opcoes)) return null;

  if (digitos.startsWith("55") && telefoneBRValido(digitos.slice(2), opcoes)) return null;

  if (digitos.length < 10) {
    return `tem ${digitos.length} dígito${digitos.length === 1 ? "" : "s"} — falta o DDD ou faltam dígitos do número`;
  }

  if (digitos.length === 10) {
    const ddd = Number(digitos.slice(0, 2));
    if (!(ddd >= DDD_MIN && ddd <= DDD_MAX)) return `DDD ${digitos.slice(0, 2)} não existe`;
    if (digitos[2] >= "6") return "é um celular antigo, sem o nono dígito";
    if (opcoes?.somenteCelular) return "é um telefone fixo, e o checkout do cartão só aceita celular";
    return "não é um fixo nem um celular válido";
  }

  if (digitos.length === 11) {
    const ddd = Number(digitos.slice(0, 2));
    if (!(ddd >= DDD_MIN && ddd <= DDD_MAX)) return `DDD ${digitos.slice(0, 2)} não existe`;
    return "tem 11 dígitos mas não tem o 9 logo após o DDD";
  }

  if (digitos.startsWith("55")) {
    return "tem o DDI 55, mas o número nacional está incompleto ou fora do padrão";
  }

  return `tem ${digitos.length} dígitos — mais do que um telefone brasileiro`;
}

/** Formatação só para exibição: (51) 9 9550 6078 / (51) 3093 2840. */
export function formatarTelefoneBR(valor: unknown): string {
  const digitos = soDigitos(valor);
  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos[2]} ${digitos.slice(3, 7)} ${digitos.slice(7)}`;
  }
  if (digitos.length === 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)} ${digitos.slice(6)}`;
  }
  return String(valor ?? "");
}
