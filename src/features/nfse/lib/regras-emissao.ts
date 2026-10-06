/**
 * NFS-e emitida pela Fila de Notas Fiscais — as regras, sem tela e sem banco.
 *
 * Módulo puro (sem imports): é lido pelo botão da Fila, pela janela "Gerar
 * NFS-e" e pelas rotas `/api/fiscal/rascunho-nfse` e `/api/fiscal/consultar-nfse`.
 * A tela e o servidor decidem pela MESMA função; se divergissem, a tela
 * ofereceria o que a rota recusa.
 *
 * O CAMINHO
 *   botão "NFS-e" na linha do pedido → janela → rota de rascunho (chama
 *   `fn_criar_rascunho_nfse` como servidor) → rota oficial de emissão
 *   (`/api/fiscal/emitir-nfse`) → acompanhamento pela rota de consulta, com o
 *   status LIDO DO BANCO. A tela nunca escreve em `notas_servico`.
 */

/** Serviço único da NFS-e (item 13.05.01 da lista, NBS 121011000). */
export const SERVICO_NFSE = { id: 1, codigo: "13.05.01", nbs: "121011000", nome: "Serviços de impressão / composição gráfica" } as const;

/**
 * Empresas que podem emitir NFS-e pela Fila. LISTA FECHADA NO CÓDIGO, de
 * propósito: ligar `habilita_nfse` no cadastro de outra empresa não a libera.
 * 2 = Ideal Birô.
 */
export const EMPRESAS_NFSE_LIBERADAS: readonly number[] = [2];

/**
 * Empresa emitente a partir do texto de `propostas.empresa`.
 *
 * É a MESMA regra de `resolverEmpresaEmitente` (features/nfe/services/nfe.service)
 * e de `getFaturaveisPropostas`, que monta a Fila. Fica repetida aqui porque
 * aquele arquivo é do navegador e não pode ser importado por uma rota; o teste
 * `nfse-regras-emissao.test.mts` trava os mesmos casos.
 */
export function empresaEmitenteDoTexto(empresaTexto: string | null | undefined): number {
  const texto = (empresaTexto || "").toUpperCase();
  if (texto.includes("BIRO") || texto.includes("BIRÔ")) return 2;
  if (texto.includes("E3")) return 3;
  return 1;
}

export function empresaLiberadaParaNfse(idEmpresa: number | null | undefined): boolean {
  return typeof idEmpresa === "number" && EMPRESAS_NFSE_LIBERADAS.includes(idEmpresa);
}

/* ------------------------------------------------------------------ status */

/**
 * O que cada status de `notas_servico` significa para o pedido.
 *
 * Quem grava cada um (conferido em 06/10/2026):
 *   PENDENTE            `fn_criar_rascunho_nfse` (rascunho novo)
 *   PRONTA_PARA_ENVIO   `fn_preparar_envio_nfse`, primeiro nó da emissão
 *   ERRO_VALIDACAO      `fn_preparar_envio_nfse`, quando a conferência bloqueia
 *   PROCESSANDO         n8n, depois que a Focus aceita o envio
 *   ERRO_ENVIO          n8n, quando a Focus recusa o envio
 *   AUTORIZADA          n8n, na consulta (ou no próprio envio)
 *   ERRO_AUTORIZACAO    n8n, quando a prefeitura recusa
 *   CANCELADA           n8n, na consulta de nota cancelada
 *   RETORNO_FOCUS       n8n, quando o retorno da Focus não foi reconhecido
 *   REJEITADA, DENEGADA previstos na rota de emitir e no fluxo; nunca vistos na tabela
 */
export type SituacaoDaNfse =
  /** Documento fiscal emitido: nada mais se cria para o pedido. */
  | "AUTORIZADA"
  /** Rascunho ainda não enviado: reabre o mesmo. */
  | "RASCUNHO"
  /** Em trânsito ou em estado que o Vibe não reconhece: ninguém mexe. */
  | "EM_ANALISE"
  /** O envio falhou antes de virar nota: reenvia a MESMA nota. */
  | "REENVIAR"
  /** A nota morreu (recusada pela prefeitura ou cancelada): pode nascer outra. */
  | "ENCERRADA";

const SITUACAO_POR_STATUS: Record<string, SituacaoDaNfse> = {
  AUTORIZADA: "AUTORIZADA",
  PENDENTE: "RASCUNHO",
  PRONTA_PARA_ENVIO: "RASCUNHO",
  ERRO_ENVIO: "REENVIAR",
  // A conferência bloqueou antes do envio (dado de cadastro): corrigido o
  // cadastro, é a mesma nota que segue. A rota de emitir aceita este status.
  ERRO_VALIDACAO: "REENVIAR",
  ERRO_AUTORIZACAO: "ENCERRADA",
  CANCELADA: "ENCERRADA",
  REJEITADA: "ENCERRADA",
  DENEGADA: "ENCERRADA"
};

/**
 * Lista FECHADA: `PROCESSANDO*`, `RETORNO_FOCUS` e qualquer status que não
 * esteja no mapa caem em "em análise". Status novo no fluxo nunca vira, por
 * engano, permissão para emitir de novo.
 */
export function situacaoDoStatus(status: string | null | undefined): SituacaoDaNfse {
  const chave = String(status ?? "").trim().toUpperCase();
  return SITUACAO_POR_STATUS[chave] ?? "EM_ANALISE";
}

/** Só nota em análise é consultada na Focus; as outras já têm desfecho no banco. */
export function statusPedeConsulta(status: string | null | undefined): boolean {
  return situacaoDoStatus(status) === "EM_ANALISE";
}

export type NotaDeServicoDoPedido = {
  ref: string;
  status: string | null;
  numero_nfse?: string | number | null;
  created_at?: string | null;
};

export type DecisaoDoPedido<N extends NotaDeServicoDoPedido> =
  /** Pedido sem nota viva: cria rascunho. `encerrada` é a última que morreu, se houver. */
  | { acao: "CRIAR"; nota: null; encerrada: N | null }
  | { acao: "MOSTRAR_AUTORIZADA"; nota: N }
  | { acao: "REABRIR_RASCUNHO"; nota: N }
  | { acao: "REENVIAR"; nota: N }
  | { acao: "EM_ANALISE"; nota: N };

function maisRecentePrimeiro<N extends NotaDeServicoDoPedido>(a: N, b: N): number {
  const porData = String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  return porData !== 0 ? porData : String(b.ref).localeCompare(String(a.ref));
}

/**
 * O que fazer com o pedido, dadas TODAS as notas de serviço dele.
 *
 *   1. alguma AUTORIZADA      → mostra a nota (a mais recente); nada se cria;
 *   2. alguma em análise      → espera; nada se cria;
 *   3. senão, vale a nota MAIS RECENTE: rascunho reabre, erro de envio reenvia,
 *      nota encerrada (ou nenhuma) permite rascunho novo.
 *
 * O passo 3 olha só a mais recente de propósito: rascunho errado não se edita,
 * cria-se outro, e o antigo fica para trás sem voltar a mandar no pedido.
 */
export function decidirNfseDoPedido<N extends NotaDeServicoDoPedido>(notas: readonly N[]): DecisaoDoPedido<N> {
  const ordenadas = [...notas].sort(maisRecentePrimeiro);
  const autorizada = ordenadas.find((n) => situacaoDoStatus(n.status) === "AUTORIZADA");
  if (autorizada) return { acao: "MOSTRAR_AUTORIZADA", nota: autorizada };
  const emAnalise = ordenadas.find((n) => situacaoDoStatus(n.status) === "EM_ANALISE");
  if (emAnalise) return { acao: "EM_ANALISE", nota: emAnalise };

  const ultima = ordenadas[0];
  if (!ultima) return { acao: "CRIAR", nota: null, encerrada: null };
  const situacao = situacaoDoStatus(ultima.status);
  if (situacao === "RASCUNHO") return { acao: "REABRIR_RASCUNHO", nota: ultima };
  if (situacao === "REENVIAR") return { acao: "REENVIAR", nota: ultima };
  return { acao: "CRIAR", nota: null, encerrada: ultima };
}

/** Rascunho ou envio com erro podem ser trocados por um rascunho novo, a pedido de quem emite. */
export function decisaoPermiteRascunhoNovo(acao: DecisaoDoPedido<NotaDeServicoDoPedido>["acao"]): boolean {
  return acao === "CRIAR" || acao === "REABRIR_RASCUNHO" || acao === "REENVIAR";
}

/** O texto do botão da Fila, pelo estado da NFS-e do pedido. */
export function rotuloDoBotaoNfse(decisao: DecisaoDoPedido<NotaDeServicoDoPedido>): string {
  if (decisao.acao === "MOSTRAR_AUTORIZADA") {
    const numero = String(decisao.nota.numero_nfse ?? "").trim();
    return numero ? `NFS-e nº ${numero}` : "NFS-e autorizada";
  }
  if (decisao.acao === "EM_ANALISE") return "NFS-e em análise";
  if (decisao.acao === "REENVIAR") return "NFS-e (reenviar)";
  return "NFS-e";
}

/* --------------------------------------------------------------- descrição */

/** Limite da Focus para `descricao_servico`, que é onde `discriminacao` vai. */
export const LIMITE_DESCRICAO_NFSE = 1000;

export type ItemDoPedidoParaNfse = { nome: string | null; quantidade: number | null; valorUnitario: number | null };

function moeda(valor: number): string {
  const [inteiro, centavos] = (Math.round(valor * 100) / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/** Uma linha por item: "100 x Ingresso MOBI - R$ 1,50 un.". Texto de partida, editável. */
export function descricaoDosItens(idInt: number, itens: readonly ItemDoPedidoParaNfse[]): string {
  const linhas = itens
    .map((item) => {
      const nome = String(item.nome ?? "").replace(/\s+/g, " ").trim();
      if (!nome) return "";
      const quantidade = Number(item.quantidade);
      const unitario = Number(item.valorUnitario);
      const qtd = Number.isFinite(quantidade) && quantidade > 0 ? `${quantidade.toLocaleString("pt-BR")} x ` : "";
      const valor = Number.isFinite(unitario) && unitario > 0 ? ` - ${moeda(unitario)} un.` : "";
      return `${qtd}${nome}${valor}`;
    })
    .filter(Boolean);
  return [`Pedido ${idInt}`, ...linhas].join("\n");
}

export type ConferenciaDaDescricao = { ok: true; texto: string } | { ok: false; motivo: string };

/** A descrição que vai para a nota: sem espaço nas pontas, de 1 a 1000 caracteres. */
export function conferirDescricao(texto: unknown): ConferenciaDaDescricao {
  const limpo = typeof texto === "string" ? texto.replace(/\r\n/g, "\n").trim() : "";
  if (!limpo) return { ok: false, motivo: "Informe a descrição do serviço." };
  if (limpo.length > LIMITE_DESCRICAO_NFSE) {
    return {
      ok: false,
      motivo: `A descrição tem ${limpo.length} caracteres. O limite é ${LIMITE_DESCRICAO_NFSE}.`
    };
  }
  return { ok: true, texto: limpo };
}

/* ------------------------------------------------------------------- valor */

export type ConferenciaDoValor = { ok: true; valor: number } | { ok: false; motivo: string };

/** Valor do serviço: número maior que zero, com duas casas. Aceita "1.234,56". */
export function conferirValor(entrada: unknown): ConferenciaDoValor {
  let numero: number;
  if (typeof entrada === "number") numero = entrada;
  else if (typeof entrada === "string" && entrada.trim()) {
    const texto = entrada.trim().replace(/[R$\s]/g, "");
    numero = Number(texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto);
  } else numero = Number.NaN;
  if (!Number.isFinite(numero) || numero <= 0) return { ok: false, motivo: "Informe um valor maior que zero." };
  const arredondado = Math.round(numero * 100) / 100;
  if (arredondado <= 0) return { ok: false, motivo: "Informe um valor maior que zero." };
  return { ok: true, valor: arredondado };
}

/** O valor informado difere do total do pedido? (centavo a centavo) */
export function valorDifereDoPedido(valor: number, totalDoPedido: number | null | undefined): boolean {
  const total = Number(totalDoPedido);
  if (!Number.isFinite(total)) return false;
  return Math.round(valor * 100) !== Math.round(total * 100);
}

/* ----------------------------------------------------------------- tomador */

/** CPF (11 dígitos) ou CNPJ (14). Sem um dos dois o rascunho não nasce. */
export function documentoDoTomador(documento: string | null | undefined): { ok: boolean; tipo: "CPF" | "CNPJ" | null } {
  const digitos = String(documento ?? "").replace(/\D/g, "");
  if (digitos.length === 11) return { ok: true, tipo: "CPF" };
  if (digitos.length === 14) return { ok: true, tipo: "CNPJ" };
  return { ok: false, tipo: null };
}

export type ConferenciaDoEndereco = { ok: true; idEndereco: string | null } | { ok: false; motivo: string };

/**
 * O endereço do tomador: escolha obrigatória quando o cliente tem algum, e tem
 * de ser um dos dele. Cliente sem endereço segue sem (a nota sai sem endereço).
 */
export function conferirEndereco(escolhido: unknown, idsDoCliente: readonly string[]): ConferenciaDoEndereco {
  const id = typeof escolhido === "string" ? escolhido.trim().toLowerCase() : "";
  if (idsDoCliente.length === 0) {
    return id
      ? { ok: false, motivo: "O endereço informado não pertence ao tomador." }
      : { ok: true, idEndereco: null };
  }
  if (!id) return { ok: false, motivo: "Escolha o endereço do tomador." };
  const doCliente = idsDoCliente.find((candidato) => candidato.toLowerCase() === id);
  if (!doCliente) return { ok: false, motivo: "O endereço informado não pertence ao tomador." };
  return { ok: true, idEndereco: doCliente };
}

/* ---------------------------------------------------------- acompanhamento */

/** A janela consulta a cada 15 s, no máximo 20 vezes (5 minutos), e então para. */
export const INTERVALO_CONSULTA_NFSE_MS = 15_000;
export const MAXIMO_DE_CONSULTAS_NFSE = 20;

export type AmbienteDaEmpresa = "producao" | "homologacao" | null;

export function ambienteDaEmpresa(valor: string | null | undefined): AmbienteDaEmpresa {
  const texto = String(valor ?? "").trim().toLowerCase();
  return texto === "producao" || texto === "homologacao" ? texto : null;
}
