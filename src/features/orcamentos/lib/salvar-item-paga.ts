/**
 * "SALVAR ITEM" EM PROPOSTA PAGA (21/10/2026) — a pergunta da diferenca so no Salvar final.
 *
 * Ate aqui, em proposta com pagamento confirmado, cada "Salvar item" chamava o Salvar
 * completo: a rota `editar-paga` gravava a proposta, abria/ajustava a pendencia de
 * Conta Corrente e o modal da diferenca abria — uma vez por item. Responder no meio
 * da edicao (devolver, bonificar) encerrava a pendencia, e a edicao seguinte abria
 * outra: varias perguntas e varios lancamentos.
 *
 * Agora, em proposta paga, "Salvar item" so fecha o card no estado da tela e avisa a
 * diferenca atual (calculada na tela, nada gravado). O "Salvar alterações" e o ponto
 * unico: uma chamada a `editar-paga`, uma pendencia, uma pergunta. Proposta sem
 * pagamento confirmado: igual a antes. Regras de destino, calculos, rota, RPCs e
 * Conta Corrente nao mudam.
 *
 * "Proposta paga" e a regra unica do formulario: `isPropostaPagaAtual`
 * (valor pago confirmado > 0, o mesmo criterio da `editar-paga`).
 *
 * Sem imports de proposito: roda no navegador e no teste do Node, igual.
 */

/** "Salvar item" fica so na tela? So em proposta ja gravada (edicao) com pagamento confirmado. */
export function salvarItemSoNaTela(entrada: { modo: string; propostaPaga: boolean }): boolean {
  return entrada.modo === "edit" && entrada.propostaPaga;
}

const reais = (valor: number) =>
  `R$ ${Math.abs(valor).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * O aviso informativo da diferenca atual (sinal de `calcularDiferencaFinanceira`:
 * negativo = a favor do cliente; positivo = a favor da empresa). Nada e gravado.
 */
export function avisoDaDiferencaNaTela(diferenca: number): { titulo: string; descricao: string } {
  const sufixo = "A decisão sobre a diferença é pedida uma vez, ao clicar em Salvar alterações.";
  if (Math.abs(diferenca) < 0.01) {
    return { titulo: "Item atualizado na tela", descricao: `O total segue igual ao valor pago. Clique em Salvar alterações para gravar.` };
  }
  return {
    titulo: "Item atualizado na tela (ainda não gravado)",
    descricao:
      diferenca < 0
        ? `Diferença atual: ${reais(diferenca)} a favor do cliente. ${sufixo}`
        : // Devedora: a rota nao pergunta (regra de 22/07/2026); o saldo fica a cobrar na aba Pagamentos.
          `Diferença atual: ${reais(diferenca)} a cobrar do cliente. Ao clicar em Salvar alterações, ela fica como saldo a cobrar na aba Pagamentos.`
  };
}

/**
 * Salvar de novo SEM MUDANCA, em proposta paga, nao chama a `editar-paga`: a rota
 * reconcilia a pendencia aberta e devolveria a mesma diferenca, e o modal perguntaria
 * outra vez sobre o que ja foi respondido. Sem mudanca = formulario limpo, nenhum lote
 * por gravar e o total da tela igual ao carregado (o frete nao suja o formulario).
 */
export function salvarSemMudancaEmPropostaPaga(entrada: {
  modo: string;
  propostaPaga: boolean;
  formularioSujo: boolean;
  lotesPorGravar: boolean;
  totalDaTela: number;
  totalCarregado: number | null | undefined;
}): boolean {
  if (!salvarItemSoNaTela({ modo: entrada.modo, propostaPaga: entrada.propostaPaga })) return false;
  if (entrada.formularioSujo || entrada.lotesPorGravar) return false;
  if (typeof entrada.totalCarregado !== "number" || !Number.isFinite(entrada.totalCarregado)) return false;
  return Math.abs(entrada.totalDaTela - entrada.totalCarregado) < 0.005;
}
