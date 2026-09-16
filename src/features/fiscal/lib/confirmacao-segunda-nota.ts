/**
 * O texto que o operador lê ANTES de o pedido ganhar uma segunda nota.
 *
 * POR QUE EXISTE
 *   "Gerar outra nota de venda" e "Gerar nota de remessa" ficam lado a lado no
 *   menu de uma nota AUTORIZADA, e as duas criam documento fiscal novo para um
 *   pedido que já tem nota. Clicar por engano é fácil; desfazer, não. A
 *   confirmação diz o que já existe, com número e ref, e o que vai ser criado —
 *   é a diferença entre saber e supor.
 *
 *   O texto é montado aqui, fora da tela, porque é a parte que importa conferir:
 *   uma função pura, que recebe as notas e devolve a frase.
 *
 * O QUE ENTRA NA LISTA
 *   Só AUTORIZADA de PRODUÇÃO, o mesmo recorte de `escolherNotaAutorizadaDoPedido`
 *   e o mesmo que decide se as ações aparecem. Homologação é teste e citá-la
 *   aqui faria o operador contar notas que não existem para ninguém. Autorizada
 *   sem número entra assinalada: ela existe, e o operador precisa vê-la.
 *
 *   A REMESSA entra na lista, embora nunca seja "a nota do pedido". A lista é o
 *   inventário do que existe, não a escolha de quem representa o pedido — e uma
 *   remessa já emitida é exatamente o tipo de coisa que muda a decisão de emitir
 *   outra.
 */
import { escolherNotaAutorizadaDoPedido, type NotaCandidata } from "@/lib/fiscal/nota-do-pedido";

export type NotaDoPedidoParaCitar = NotaCandidata & { ref?: string | null };

const ehRemessa = (nota: NotaDoPedidoParaCitar) =>
  String(nota.tipo_nota ?? "").trim().toUpperCase() === "REMESSA";

const emMilissegundos = (valor: unknown): number => Date.parse(String(valor ?? "")) || 0;

const dataCurta = (valor: string | null | undefined): string => {
  if (!valor) return "sem data de autorização";
  const quando = new Date(valor);
  if (Number.isNaN(quando.getTime())) return "sem data de autorização";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(quando);
};

/** As autorizadas de produção do pedido, da mais antiga para a mais nova. */
export function notasAutorizadasParaCitar<T extends NotaDoPedidoParaCitar>(
  notas: readonly T[] | null | undefined
): T[] {
  return (notas ?? [])
    .filter(
      (nota) =>
        String(nota.status ?? "").toUpperCase() === "AUTORIZADA" &&
        String(nota.ambiente ?? "").trim().toUpperCase() === "PRODUCAO"
    )
    .sort((a, b) => {
      const autorizacao = emMilissegundos(a.data_autorizacao) - emMilissegundos(b.data_autorizacao);
      if (autorizacao !== 0) return autorizacao;
      return emMilissegundos(a.created_at) - emMilissegundos(b.created_at);
    });
}

/** Uma linha da lista: "NF 7501 - NFE-22066-001 (venda), autorizada em 15/09/2026". */
function linhaDaNota(nota: NotaDoPedidoParaCitar, ehOrigem: boolean): string {
  const numero = String(nota.numero_nf ?? "").trim();
  const identificacao = numero ? `NF ${numero}` : "NF sem número";
  const ref = String(nota.ref ?? "").trim();
  const tipo = ehRemessa(nota) ? "remessa" : "venda";
  const marca = ehOrigem ? "> " : "  ";
  return `${marca}${identificacao}${ref ? ` - ${ref}` : ""} (${tipo}), autorizada em ${dataCurta(nota.data_autorizacao)}`;
}

/**
 * A pergunta inteira, em texto corrido.
 *
 * Quem exibe é o modal do sistema (`partesDaConfirmacaoDeSegundaNota` parte isto
 * em título e corpo). As quebras de linha e a indentação da lista fazem parte do
 * conteúdo: quem renderizar precisa preservá-las.
 *
 * `origem` — a nota de venda que a remessa herda — é escolhida por
 * `escolherNotaAutorizadaDoPedido`, a MESMA função que `criarRascunhoRemessa`
 * usa. Se as duas divergissem, o operador confirmaria uma nota e o sistema
 * copiaria outra.
 */
export function textoDeConfirmacaoDeSegundaNota(args: {
  idInt: number;
  tipo: "VENDA" | "REMESSA";
  notas: readonly NotaDoPedidoParaCitar[];
}): string {
  const autorizadas = notasAutorizadasParaCitar(args.notas);
  const origem = escolherNotaAutorizadaDoPedido(args.notas);
  const refOrigem = String(origem?.ref ?? "").trim();

  const cabecalho =
    args.tipo === "VENDA"
      ? `Gerar OUTRA nota de venda do pedido #${args.idInt}?`
      : `Gerar nota de REMESSA do pedido #${args.idInt}?`;

  const titulo =
    autorizadas.length === 0
      ? "Este pedido não tem nota autorizada de produção."
      : autorizadas.length === 1
        ? "Este pedido já tem uma nota autorizada:"
        : `Este pedido já tem ${autorizadas.length} notas autorizadas:`;

  // A seta só aparece quando há mais de uma nota: com uma só, apontar qual é a
  // origem não informa nada e o sinal vira ruído.
  const marcarOrigem = args.tipo === "REMESSA" && refOrigem !== "" && autorizadas.length > 1;
  const lista = autorizadas
    .map((nota) => linhaDaNota(nota, marcarOrigem && String(nota.ref ?? "").trim() === refOrigem))
    .join("\n");

  const legendaDaOrigem = marcarOrigem ? "\n(>) A remessa nasce desta nota de venda." : "";

  const oQueVaiSerCriado =
    args.tipo === "VENDA"
      ? "Vai ser criada uma SEGUNDA nota de VENDA deste mesmo pedido, com número próprio.\nÉ o faturamento parcial: use quando parte do pedido ainda não foi faturada."
      : "Vai ser criada uma nota de REMESSA deste pedido.\nEla sai no nome de quem RECEBE a mercadoria, no endereço de entrega, e não substitui a nota de venda.";

  const rodape = "Nada é transmitido agora: o rascunho abre para você conferir antes de emitir.";

  return [
    cabecalho,
    "",
    titulo,
    autorizadas.length > 0 ? lista + legendaDaOrigem : null,
    "",
    oQueVaiSerCriado,
    "",
    rodape
  ]
    .filter((linha) => linha !== null)
    .join("\n");
}

/**
 * A MESMA confirmação, partida em título e corpo para o modal.
 *
 * O texto continua sendo montado por `textoDeConfirmacaoDeSegundaNota` — esta
 * função só corta na primeira linha em branco, porque o modal do projeto tem
 * cabeçalho e corpo separados. Nada é reescrito no caminho: o que aparece na
 * tela é, palavra por palavra, o que aquela função devolve.
 */
export function partesDaConfirmacaoDeSegundaNota(args: {
  idInt: number;
  tipo: "VENDA" | "REMESSA";
  notas: readonly NotaDoPedidoParaCitar[];
}): { titulo: string; corpo: string } {
  const texto = textoDeConfirmacaoDeSegundaNota(args);
  const corte = texto.indexOf("\n\n");
  if (corte < 0) return { titulo: texto, corpo: "" };
  return { titulo: texto.slice(0, corte), corpo: texto.slice(corte + 2) };
}
