/**
 * Janela "Gerar NFS-e" — a COMPOSIÇÃO da nota: endereços do tomador, itens do
 * pedido, valor, pagamento (só leitura) e a triagem dos alertas.
 *
 * Módulo puro (sem imports). A janela mostra o que estas funções devolvem; o
 * que vai para as rotas continua sendo valor, descrição, endereço e serviço.
 */

/* --------------------------------------------------------------- endereços */

export type EnderecoBruto = {
  id: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  tipo: string;
  municipioReconhecido: boolean;
};

export type OpcaoDeEndereco = {
  id: string;
  /** "Rua, nº – Bairro – Cidade/UF – CEP". */
  rotulo: string;
  /** Cadastro com texto inválido ("[object Object]", "NULL", "<RUA>"): não pode ser escolhido. */
  incompleto: boolean;
  municipioReconhecido: boolean;
  /** Quantos cadastros idênticos este representa (1 = sem repetição). */
  repeticoes: number;
};

/** Texto que denuncia cadastro quebrado, e não um endereço. */
export function textoDeCadastroInvalido(valor: string | null | undefined): boolean {
  const texto = String(valor ?? "").trim();
  if (!texto) return false;
  const maiusculo = texto.toUpperCase();
  return texto.includes("[object Object]") || maiusculo === "NULL" || maiusculo === "UNDEFINED" || /^<[^>]*>$/.test(texto);
}

/** O endereço tem algum campo com texto de cadastro quebrado? */
export function enderecoComCadastroIncompleto(e: EnderecoBruto): boolean {
  return [e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep].some(textoDeCadastroInvalido);
}

function limpo(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

function cepFormatado(cep: string): string {
  const digitos = cep.replace(/\D/g, "");
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : limpo(cep);
}

/** "Rua, nº – Bairro – Cidade/UF – CEP". Parte vazia some; nada vira "undefined". */
export function rotuloDoEndereco(e: EnderecoBruto): string {
  const rua = [limpo(e.logradouro), limpo(e.numero)].filter(Boolean).join(", ");
  const cidade = [limpo(e.cidade), limpo(e.uf).toUpperCase()].filter(Boolean).join("/");
  const cep = cepFormatado(e.cep);
  const partes = [rua, limpo(e.bairro), cidade, cep ? `CEP ${cep}` : ""].filter(Boolean);
  return partes.join(" – ") || "(endereço sem dados)";
}

function chaveDeRepeticao(e: EnderecoBruto): string {
  const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return [semAcento(e.logradouro), semAcento(e.numero), e.cep.replace(/\D/g, "")].join("|");
}

/**
 * As opções do seletor. Cadastros idênticos (mesmo logradouro, número e CEP)
 * aparecem uma vez só: fica o primeiro que pode ser usado (sem texto inválido),
 * e entre iguais o de tipo PRINCIPAL. A ordem de entrada é mantida.
 */
export function opcoesDeEndereco(enderecos: readonly EnderecoBruto[]): OpcaoDeEndereco[] {
  const grupos = new Map<string, EnderecoBruto[]>();
  const ordem: string[] = [];
  for (const e of enderecos) {
    const chave = chaveDeRepeticao(e);
    if (!grupos.has(chave)) {
      grupos.set(chave, []);
      ordem.push(chave);
    }
    grupos.get(chave)!.push(e);
  }
  return ordem.map((chave) => {
    const grupo = grupos.get(chave)!;
    const nota = (e: EnderecoBruto) =>
      (enderecoComCadastroIncompleto(e) ? 0 : 4) + (e.municipioReconhecido ? 2 : 0) + (limpo(e.tipo).toUpperCase() === "PRINCIPAL" ? 1 : 0);
    const escolhido = grupo.reduce((melhor, e) => (nota(e) > nota(melhor) ? e : melhor), grupo[0]);
    return {
      id: escolhido.id,
      rotulo: rotuloDoEndereco(escolhido),
      incompleto: enderecoComCadastroIncompleto(escolhido),
      municipioReconhecido: escolhido.municipioReconhecido,
      repeticoes: grupo.length
    };
  });
}

/** Com um só endereço utilizável na lista inteira, ele vem escolhido; com vários, ninguém. */
export function enderecoInicial(opcoes: readonly OpcaoDeEndereco[]): string {
  return opcoes.length === 1 && !opcoes[0].incompleto ? opcoes[0].id : "";
}

/* ------------------------------------------------------------------- itens */

export type ItemDoPedido = {
  id: number;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  /** `produtos_proposta.valor_sub_total`: quantidade × unitário MAIS o valor fixo do item, quando há. */
  subtotal: number;
};

const centavos = (valor: number) => Math.round((Number(valor) || 0) * 100);

/** Soma dos subtotais dos itens marcados. */
export function somaDosItensMarcados(itens: readonly ItemDoPedido[], marcados: ReadonlySet<number>): number {
  return itens.reduce((total, item) => (marcados.has(item.id) ? total + centavos(item.subtotal) : total), 0) / 100;
}

/**
 * Quanto do preço de tabela o pedido realmente cobra pelos produtos.
 *
 * `valorDosProdutos` é `propostas.valor`: os itens JÁ com o desconto geral do
 * pedido e SEM o frete. Dividido pela soma dos subtotais, dá o fator do
 * desconto (0,9 num pedido com 10%). Sem desconto é 1. Valor estranho (zero,
 * negativo, maior que a soma) também vira 1: a janela nunca inventa desconto
 * nem acréscimo.
 */
export function fatorDoDesconto(valorDosProdutos: number | null | undefined, somaDeTodosOsItens: number): number {
  const liquido = Number(valorDosProdutos);
  if (!Number.isFinite(liquido) || liquido <= 0 || !(somaDeTodosOsItens > 0)) return 1;
  const fator = liquido / somaDeTodosOsItens;
  return fator > 0 && fator < 1 ? fator : 1;
}

/**
 * O valor que a janela sugere para a nota: os itens marcados, com o desconto
 * geral do pedido na mesma proporção. O frete não entra (não é serviço).
 */
export function valorSugeridoDaNota(itens: readonly ItemDoPedido[], marcados: ReadonlySet<number>, valorDosProdutos: number | null | undefined): number {
  const todos = itens.reduce((total, item) => total + centavos(item.subtotal), 0) / 100;
  const soma = somaDosItensMarcados(itens, marcados);
  return Math.round(soma * fatorDoDesconto(valorDosProdutos, todos) * 100) / 100;
}

/** Pelo menos um item tem de ficar marcado: o último não pode ser desmarcado. */
export function alternarItemMarcado(marcados: ReadonlySet<number>, id: number): Set<number> {
  const novo = new Set(marcados);
  if (novo.has(id)) {
    if (novo.size > 1) novo.delete(id);
  } else {
    novo.add(id);
  }
  return novo;
}

/* ----------------------------------------------------------------- tomador */

/** CPF ou CNPJ com máscara; o que não tem 11 nem 14 dígitos volta como está. */
export function documentoFormatado(documento: string | null | undefined): string {
  const bruto = String(documento ?? "").trim();
  const d = bruto.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return bruto;
}

/** Texto de contato para a tela: vazio, "NULL" ou "undefined" vira "não informado". */
export function contatoOuNaoInformado(valor: string | null | undefined): string {
  const texto = String(valor ?? "").trim();
  if (!texto || ["NULL", "UNDEFINED", "-"].includes(texto.toUpperCase())) return "não informado";
  return texto;
}

/* --------------------------------------------------------------- pagamento */

export type CobrancaDoPedido = {
  tipo: string | null;
  forma: string | null;
  valor: number | null;
  vencimento: string | null;
  status: string | null;
  confirmado: boolean | null;
  parcelas: number | null;
  intervaloDias: number | null;
  valorEntrada: number | null;
};

export type ParcelaDaCobranca = { numero: number; total: number; vencimento: string | null; valor: number };

export type PagamentoParaConferencia = {
  forma: string;
  parcelas: number;
  valor: number;
  situacao: string;
  vencimentos: ParcelaDaCobranca[];
};

const NOME_DA_FORMA: Record<string, string> = {
  PIX: "PIX",
  BOLETO: "Boleto",
  CARD_PARCELADO: "Cartão",
  "E-FATURADO": "Faturado",
  "E-CREDITO": "Crédito do cliente",
  "E-AMOSTRA": "Amostra",
  "E-RETRABALHO": "Retrabalho",
  "E-PERMUTA": "Permuta"
};

function somarDias(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.slice(0, 10).split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return data.toISOString().slice(0, 10);
}

/** Cobrança cancelada não entra na conferência. */
export function cobrancaAtiva(c: CobrancaDoPedido): boolean {
  return !["CANCELADO", "CANCELADA"].includes(String(c.status ?? "").trim().toUpperCase());
}

/**
 * As cobranças ativas do pedido, do jeito que a seção "Pagamento do pedido"
 * mostra. SÓ PARA CONFERÊNCIA: a NFS-e nacional não leva parcelas, e nada daqui
 * é enviado à Focus.
 *
 * Os vencimentos das parcelas seguintes são calculados pelo intervalo da
 * condição (1ª no vencimento da cobrança, as demais de `intervaloDias` em
 * `intervaloDias`); sem intervalo, só a 1ª tem data.
 */
export function pagamentosParaConferencia(cobrancas: readonly CobrancaDoPedido[]): PagamentoParaConferencia[] {
  return cobrancas.filter(cobrancaAtiva).map((c) => {
    const tipo = String(c.tipo ?? "").trim().toUpperCase();
    const nome = NOME_DA_FORMA[tipo] ?? (tipo || "Não informada");
    const condicao = String(c.forma ?? "").trim();
    const total = Math.max(1, Math.trunc(Number(c.parcelas) || 1));
    const valor = Math.round((Number(c.valor) || 0) * 100) / 100;
    const entrada = Math.max(0, Math.round((Number(c.valorEntrada) || 0) * 100) / 100);
    const intervalo = Math.max(0, Math.trunc(Number(c.intervaloDias) || 0));
    const porParcela = Math.round(((valor - entrada) / total) * 100) / 100;

    const vencimentos: ParcelaDaCobranca[] = [];
    for (let i = 0; i < total; i += 1) {
      const data = c.vencimento ? (i === 0 ? c.vencimento.slice(0, 10) : intervalo > 0 ? somarDias(c.vencimento, intervalo * i) : null) : null;
      // A última parcela leva o que sobrou do arredondamento.
      const valorDaParcela = i === total - 1 ? Math.round((valor - entrada - porParcela * (total - 1)) * 100) / 100 : porParcela;
      vencimentos.push({ numero: i + 1, total, vencimento: data, valor: valorDaParcela });
    }

    const status = String(c.status ?? "").trim().toUpperCase();
    const situacao =
      status === "PAID" ? "Pago" : status === "A_VENCER" ? "A vencer" : status ? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ") : "Sem status";

    return {
      forma: condicao && condicao.toUpperCase() !== tipo ? `${nome} · ${condicao}` : nome,
      parcelas: total,
      valor,
      situacao: c.confirmado === true ? situacao : `${situacao} (não confirmado)`,
      vencimentos
    };
  });
}

/* ------------------------------------------------------------------ status */

export type SeloDaNota = { rotulo: "Rascunho" | "Em análise" | "Autorizada" | "Erro"; tom: "neutro" | "aviso" | "sucesso" | "erro" };

/** O selo do cabeçalho, a partir da situação da nota (lib/regras-emissao). */
export function seloDaNota(situacao: "AUTORIZADA" | "RASCUNHO" | "EM_ANALISE" | "REENVIAR" | "ENCERRADA" | null): SeloDaNota {
  if (situacao === "AUTORIZADA") return { rotulo: "Autorizada", tom: "sucesso" };
  if (situacao === "EM_ANALISE") return { rotulo: "Em análise", tom: "aviso" };
  if (situacao === "REENVIAR" || situacao === "ENCERRADA") return { rotulo: "Erro", tom: "erro" };
  return { rotulo: "Rascunho", tom: "neutro" };
}

/* ----------------------------------------------------------------- alertas */

export type AlertaDaNota = { tipo: string; codigo: string; mensagem: string; bloqueia_envio: boolean };

/** Avisos que só informam: nada a fazer agora, e a nota autoriza com eles. */
const CODIGOS_INFORMATIVOS = new Set([
  "INSCRICAO_MUNICIPAL_NFSE_NAO_INFORMADA",
  "NATUREZA_OPERACAO_NAO_INFORMADA",
  "REGIME_ESPECIAL_TRIBUTACAO_NAO_INFORMADO",
  "CODIGO_OPCAO_SIMPLES_NACIONAL_NAO_INFORMADO"
]);

export type AlertasSeparados = {
  /** Impedem o envio: a integração recusa enquanto existirem. */
  bloqueios: AlertaDaNota[];
  /** Não impedem, mas pedem uma olhada (endereço, e-mail, descrição genérica). */
  atencao: AlertaDaNota[];
  /** Só informam; ficam recolhidos. */
  informativos: AlertaDaNota[];
  /** Sem bloqueio: vale o banner verde. */
  validado: boolean;
};

export function separarAlertas(alertas: readonly AlertaDaNota[]): AlertasSeparados {
  const bloqueios = alertas.filter((a) => a.bloqueia_envio === true);
  const naoBloqueiam = alertas.filter((a) => a.bloqueia_envio !== true);
  return {
    bloqueios,
    atencao: naoBloqueiam.filter((a) => !CODIGOS_INFORMATIVOS.has(a.codigo)),
    informativos: naoBloqueiam.filter((a) => CODIGOS_INFORMATIVOS.has(a.codigo)),
    validado: bloqueios.length === 0
  };
}
