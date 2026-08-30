import type { Proposta } from "@/features/orcamentos/types";

/**
 * Regra do PRAZO DE PRODUÇÃO — fonte única.
 *
 * Estas funções viviam dentro de `BoletimFormPage.tsx`, em escopo de módulo e
 * sem `export`. Saíram para cá em 30/08/2026 porque a lista de Produção passou
 * a precisar da mesma conta: a OS criada pelas ações de impressão nascia com
 * `propostas_os.data_termino` nulo, e derivar o prazo lá exigiria ou duplicar o
 * regex e a regra de dias úteis, ou gravar o `hoje + 7` do formulário como se
 * fosse prazo real. Nenhuma linha de lógica mudou na mudança de casa.
 *
 * `parsePrazoToDate` e `semAcento` vieram junto porque são usadas
 * exclusivamente por `dataLimitePorPrazos` — sem elas o módulo não fecharia sem
 * duplicar. Continuam privadas: ninguém fora daqui precisa delas.
 *
 * A ÚNICA adição é `dataLimitePorPrazosOuNulo`, no fim do arquivo.
 */

function parsePrazoToDate(prazoText: string): string {
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7); // Default 7 days
  
  if (!prazoText) {
    return defaultDate.toISOString().split("T")[0];
  }
  
  const match = prazoText.match(/(\d+)/);
  if (match) {
    const days = parseInt(match[1], 10);
    const date = new Date();
    date.setDate(date.getDate() + (days || 7));
    return date.toISOString().split("T")[0];
  }
  
  return defaultDate.toISOString().split("T")[0];
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Dias de produção declarados no cadastro do produto (public.produtos.prazo é
 * texto livre: "3 dias úteis", "Produção: 1 dia útil + Frete"). Vale o primeiro
 * número do texto; sem número não há prazo utilizável.
 */
export function diasDoPrazoCadastrado(prazoText?: string | null): number | null {
  const match = String(prazoText || "").match(/(\d+)/);
  if (!match) return null;
  const dias = Number(match[1]);
  return Number.isFinite(dias) && dias > 0 ? dias : null;
}

/** Data de hoje + N dias. Em "dias úteis" pula sábado e domingo (feriados não entram). */
export function somarDiasDeProducao(dias: number, emDiasUteis: boolean): string {
  const data = new Date();
  let restantes = dias;
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const diaDaSemana = data.getDay();
    if (!emDiasUteis || (diaDaSemana !== 0 && diaDaSemana !== 6)) {
      restantes -= 1;
    }
  }
  // Formatação local: toISOString() joga para UTC e adiantaria um dia à noite.
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Data limite sugerida a partir do prazo de produção cadastrado em cada produto
 * do pedido: vale sempre o maior. Dois produtos, um de 1 dia e outro de 3 dias,
 * dão a data de 3 dias. O resumo da proposta não serve aqui porque leva só o
 * prazo do primeiro item (calculateResumo). Sem prazo em nenhum produto, cai no
 * padrão de 7 dias do formulário.
 */
export function dataLimitePorPrazos(prazos: (string | null | undefined)[]): string {
  let maiorData = "";

  for (const textoPrazo of prazos) {
    const texto = textoPrazo || "";
    const dias = diasDoPrazoCadastrado(texto);
    if (dias === null) continue;

    // Compara a data resultante, não o número de dias: "2 dias úteis" pode cair
    // depois de "3 dias" corridos quando o intervalo pega um fim de semana.
    const data = somarDiasDeProducao(dias, /util|uteis/.test(semAcento(texto)));
    if (!maiorData || data > maiorData) maiorData = data;
  }

  return maiorData || parsePrazoToDate("");
}

/**
 * Data limite sugerida a partir do prazo de produção cadastrado em cada produto
 * do pedido: vale sempre o maior. Dois produtos, um de 1 dia e outro de 3 dias,
 * dão a data de 3 dias. O resumo da proposta não serve aqui porque leva só o
 * prazo do primeiro item (calculateResumo). Sem prazo em nenhum produto, cai no
 * padrão de 7 dias do formulário.
 *
 * Regra única do prazo (decisão do dono em 18/08/2026): útil ou corrido sai do
 * TEXTO do cadastro — "1 dia útil" pula fim de semana, "3 dias" não. Feriados
 * ficam de fora: o ERP não tem calendário deles. `prazoLimiteDoPedido`, que
 * contava sempre em dias úteis, não rege mais este cálculo.
 */
export function calcularDataLimitePorProdutos(itens: Proposta["itens"]): string {
  return dataLimitePorPrazos(
    itens
      .filter((item) => item.statusItem !== "CANCELADO")
      .map((item) => item.produto?.prazo || item.prazo || "")
  );
}

/**
 * Mesma conta de `dataLimitePorPrazos`, com UMA diferença: ausência de prazo
 * legível devolve `null` em vez do `hoje + 7`.
 *
 * POR QUE EXISTE
 *   O fallback de 7 dias é o default do FORMULÁRIO do boletim — uma sugestão
 *   que o operador vê e pode corrigir antes de salvar. Fora dali ele seria uma
 *   promessa inventada: a OS criada pelas ações de impressão da lista grava
 *   direto em `propostas_os.data_termino`, sem ninguém para conferir, e a
 *   coluna DATA ENTREGA passaria a exibir uma data que nunca foi prometida.
 *   Ausência de prazo é ausência — traço na tela, não data.
 *
 * NÃO É UMA SEGUNDA REGRA. O laço é o mesmo e chama as mesmas
 * `diasDoPrazoCadastrado` e `somarDiasDeProducao`: um texto legível para uma é
 * legível para a outra, e as duas produzem exatamente a mesma data. O que muda
 * é só o que acontece quando não há nenhuma.
 */
export function dataLimitePorPrazosOuNulo(prazos: (string | null | undefined)[]): string | null {
  let maiorData = "";

  for (const textoPrazo of prazos) {
    const texto = textoPrazo || "";
    const dias = diasDoPrazoCadastrado(texto);
    if (dias === null) continue;

    const data = somarDiasDeProducao(dias, /util|uteis/.test(semAcento(texto)));
    if (!maiorData || data > maiorData) maiorData = data;
  }

  return maiorData || null;
}
