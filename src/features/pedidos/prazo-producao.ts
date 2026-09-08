import { getSupabaseClient } from "@/lib/supabase/client";
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
 * Data limite pelo TEXTO de `produtos.prazo`, com o `hoje + 7` de fallback.
 *
 * !! SEM CHAMADOR desde 09/2026. O boletim e a lista de OS passaram para
 * !! `calcularDataLimitePorProdutos` / `dataLimitePorPrazosOuNulo`, que contam
 * !! por `prazo_dias_uteis` e feriado. Esta ficou de pé por decisão explícita:
 * !! `produtos.prazo` continua existindo com todos os valores, e esta é a única
 * !! leitura do que está escrito lá.
 * !!
 * !! NÃO a use para prazo novo. Ela não conhece feriado, conta a partir de HOJE
 * !! e inventa uma semana quando não entende o texto — os três motivos que
 * !! levaram à troca.
 *
 * Vale sempre o maior prazo entre os produtos: dois produtos, um de 1 dia e
 * outro de 3 dias, dão a data de 3 dias.
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
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA NOVA (09/2026) — número, calendário e o banco fazendo a conta
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O QUE MUDOU
 *   O prazo deixou de sair do TEXTO de `produtos.prazo` por regex e passou a
 *   sair de `produtos.prazo_dias_uteis` (integer), contado por
 *   `public.soma_dias_uteis`, que pula sábado, domingo E FERIADO — o que o
 *   `somarDiasDeProducao` daqui de cima nunca soube fazer.
 *
 *   A data base também mudou: não é mais "hoje", é
 *   `propostas.liberado_producao_em` — o instante em que o pedido entrou na
 *   produção. Contar a partir de hoje fazia o prazo andar para frente a cada
 *   vez que alguém reabria o boletim.
 *
 * O `hoje + 7` MORREU
 *   Ele era o default do formulário: sem prazo legível, prometia uma semana.
 *   Não havia nada por trás desse número. Agora ausência de prazo devolve
 *   `null`, o campo fica vazio na tela e alguém decide — que é o que já valia
 *   para as ações de impressão desde 30/08/2026, e agora vale para os dois.
 *
 * AS FUNÇÕES DE TEXTO ACIMA CONTINUAM AQUI
 *   `diasDoPrazoCadastrado`, `somarDiasDeProducao` e `dataLimitePorPrazos` não
 *   foram removidas: `produtos.prazo` segue existindo, com todos os valores, e
 *   apagá-las apagaria a única leitura do que está escrito lá.
 */

/**
 * O maior prazo em dias úteis entre os produtos — o que segura o pedido.
 *
 * Ignora nulo e qualquer coisa menor que 1. Zero entra nessa regra de
 * propósito: a tela de produto aceita 0 digitado à mão, e zero ali é ausência
 * de prazo mal preenchida, não promessa de entrega no mesmo dia.
 *
 * Sem nenhum prazo utilizável devolve `null` — e `null` vira campo vazio, nunca
 * uma data inventada.
 */
export function maiorPrazoDiasUteis(dias: (number | null | undefined)[]): number | null {
  let maior: number | null = null;
  for (const valor of dias) {
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 1) continue;
    if (maior === null || valor > maior) maior = valor;
  }
  return maior;
}

/**
 * A data de entrega, pela função do banco.
 *
 * POR QUE NO BANCO E NÃO AQUI
 *   A conta precisa do calendário de feriados (`public.feriados`), e trazer 26
 *   linhas para o navegador a cada cálculo — mantendo-as em sincronia com o
 *   banco — seria duplicar a fonte da verdade. `soma_dias_uteis` é STABLE e
 *   SECURITY INVOKER: quem chama pelo app é `authenticated`, que tem política
 *   de SELECT em `feriados`.
 *
 * DEVOLVE NULL, SEM INVENTAR, quando falta a data base ou o prazo. São os dois
 * casos reais: pedido ainda não liberado para produção, e produto sem
 * `prazo_dias_uteis` cadastrado.
 *
 * ATENÇÃO AO LIMITE DO CALENDÁRIO: `public.feriados` cobre até 2027-12-31.
 * Conta que atravesse essa data conta feriado a menos e devolve prazo cedo
 * demais — sem erro, nem aqui nem no banco.
 */
export async function calcularDataEntrega(
  liberadoProducaoEm: string | null | undefined,
  diasUteis: number | null
): Promise<string | null> {
  if (!liberadoProducaoEm || diasUteis === null || diasUteis < 1) return null;

  const client = getSupabaseClient();
  if (!client) return null;

  // `liberado_producao_em` é timestamptz; a função recebe date. Fatia a string
  // em vez de construir `Date`: `new Date(iso).toISOString()` volta para UTC e
  // adiantaria um dia à noite, que é o mesmo defeito já corrigido em
  // `somarDiasDeProducao`.
  const dataBase = String(liberadoProducaoEm).slice(0, 10);

  const { data, error } = await client.rpc("soma_dias_uteis", {
    data_base: dataBase,
    dias: diasUteis
  });

  if (error) {
    console.error("[prazo-producao] soma_dias_uteis falhou:", error.message);
    return null;
  }
  return typeof data === "string" ? data.slice(0, 10) : null;
}

/**
 * Data de entrega do pedido a partir dos itens da proposta.
 *
 * Item CANCELADO fora da conta: ele não é produzido, e o prazo dele não pode
 * segurar o pedido.
 *
 * Substituiu a versão que lia `item.produto?.prazo || item.prazo` por regex. O
 * `item.prazo` daquela expressão era particularmente traiçoeiro: quando o
 * produto não tinha prazo cadastrado, `orcamentos.service.ts` preenchia o item
 * com o literal "7 dias", e a conta virava uma promessa de 7 dias CORRIDOS que
 * ninguém fez. Aqui só entra `prazo_dias_uteis`, e ausência é ausência.
 */
export async function calcularDataLimitePorProdutos(
  itens: Proposta["itens"],
  liberadoProducaoEm: string | null | undefined
): Promise<string | null> {
  const dias = maiorPrazoDiasUteis(
    itens
      .filter((item) => item.statusItem !== "CANCELADO")
      .map((item) => item.produto?.prazo_dias_uteis ?? null)
  );
  return calcularDataEntrega(liberadoProducaoEm, dias);
}

/**
 * A MESMA conta de `calcularDataLimitePorProdutos`, para quem já tem os dias
 * soltos em vez dos itens da proposta.
 *
 * É o caso das ações de impressão da lista de OS: a linha da lista já carrega
 * `prazosDosProdutos` do SELECT em lote que existe, então derivar ali não custa
 * consulta nenhuma a mais — só a chamada da função do banco.
 *
 * NÃO É UMA SEGUNDA REGRA. As duas passam por `maiorPrazoDiasUteis` e
 * `calcularDataEntrega`; muda só o formato da entrada. Foi para não haver duas
 * respostas para "quando este pedido fica pronto" que elas dividem o miolo —
 * antes de 09/2026 eram duas funções com fallbacks OPOSTOS, uma caindo em
 * `hoje + 7` e a outra em `null`, e o resultado dependia de por qual tela o
 * pedido tinha passado primeiro.
 */
export async function dataLimitePorPrazosOuNulo(
  diasDosProdutos: (number | null | undefined)[],
  liberadoProducaoEm: string | null | undefined
): Promise<string | null> {
  return calcularDataEntrega(liberadoProducaoEm, maiorPrazoDiasUteis(diasDosProdutos));
}
