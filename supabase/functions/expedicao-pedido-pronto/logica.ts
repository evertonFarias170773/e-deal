/**
 * Regras puras do aviso "pedido pronto" (sem rede, sem banco), para a Edge
 * Function e para o teste scripts/testes/expedicao-aviso-pronto.test.mts.
 */

/**
 * Cliente teste #14 (contato Edison Jr): a conversa que existe no ChatGuru.
 * Único destino aceito com o modo teste ligado. Até 06/11/2026 era
 * 5551985018848, que não tem conversa no ChatGuru ("Chat não encontrado.").
 */
export const NUMERO_TESTE = "5551984608848";

export class Recusa extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Modo teste: LIGADO por padrão. Só desliga com a variável de ambiente
 * CHATGURU_PEDIDO_PRONTO_MODO_TESTE exatamente "desligado". A tela não tem
 * como mudar isto.
 */
export function modoTesteLigado(valor: string | undefined | null): boolean {
  return (valor ?? "").trim().toLowerCase() !== "desligado";
}

/**
 * WhatsApp do contato no formato do ChatGuru: tira a formatação e põe o DDI 55
 * quando o número vem só com DDD. Não mexe no nono dígito.
 */
export function telefoneWhatsApp(valor: unknown, ddi: string): string {
  if (typeof valor !== "string" || !/^[+\d\s().-]+$/.test(valor.trim())) {
    throw new Recusa(422, "O WhatsApp do contato do pedido está vazio ou inválido. Corrija o cadastro do contato.");
  }
  let n = valor.replace(/\D/g, "");
  // "+" na frente: o número já traz DDI, não se acrescenta outro.
  if (!valor.trim().startsWith("+") && /^[1-9]\d{9,10}$/.test(n)) {
    if (ddi !== "55") throw new Recusa(503, "DDI padrão do ChatGuru não configurado (CHATGURU_DEFAULT_DDI).");
    n = "55" + n;
  }
  if (!/^55[1-9]\d{9,10}$/.test(n)) {
    throw new Recusa(422, "O WhatsApp do contato do pedido precisa ter DDD e número. Corrija o cadastro do contato.");
  }
  return n;
}

/**
 * Destino final. Modo teste: qualquer destinatário vira o número de teste. A
 * conferência final recusa o envio se, por qualquer caminho, o número não for o
 * de teste.
 */
export function destinoFinal(numeroDoContato: string, modoTeste: boolean): string {
  const destino = modoTeste ? NUMERO_TESTE : numeroDoContato;
  if (modoTeste && destino !== NUMERO_TESTE) {
    throw new Recusa(403, "Modo teste: só é permitido enviar para o número de teste.");
  }
  return destino;
}

export type ExpedicaoRow = {
  modalidade_frete?: string | null;
  tipo_frete?: string | null;
  transportadora_nome?: string | null;
};

export type FormaEnvioEntrada = {
  expedicao: ExpedicaoRow | null;
  modalidadeOrcamento: string | null;
  servicoCotacao: string | null;
  nomeTransportadoraCadastro: string | null;
};

const ehRetiradaTexto = (t: string | null | undefined) => /retir/i.test(t ?? "");

/**
 * "Retirada no balcão" ou "Entrega", com a transportadora quando houver.
 * Ordem: o que o expedidor declarou (expedicoes) > o orçamento (modalidade e
 * transportadora da proposta) > o serviço da cotação escolhida.
 */
export function formaDeEnvio(e: FormaEnvioEntrada): string {
  const exp = e.expedicao;
  const tipo = (exp?.tipo_frete ?? "").toUpperCase();
  const modalidade = (exp?.modalidade_frete ?? "").toUpperCase();

  if (tipo === "RETIRA_BALCAO" || modalidade === "RETIRA") return "Retirada no balcão";
  if (tipo === "CORREIOS") return "Entrega pelos Correios";
  if (tipo === "MOTOBOY") return "Entrega por motoboy";
  if (tipo === "TRANSPORTADORA") {
    const nome = limpar(exp?.transportadora_nome) || limpar(e.nomeTransportadoraCadastro);
    return nome ? `Entrega pela transportadora ${nome}` : "Entrega por transportadora";
  }

  if ((e.modalidadeOrcamento ?? "").toUpperCase() === "RETIRA" || ehRetiradaTexto(e.servicoCotacao)) {
    return "Retirada no balcão";
  }
  const nome = limpar(e.nomeTransportadoraCadastro) || limpar(e.servicoCotacao);
  return nome ? `Entrega (${nome})` : "Entrega";
}

export function limpar(texto: unknown, max = 150): string {
  if (typeof texto !== "string") return "";
  // deno-lint-ignore no-control-regex
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export type ItemPedido = { nome_produto: string | null; qtd: number | null; status_item?: string | null };

/** Itens ativos do pedido, um por linha: "• 500 x Ingresso". */
export function linhasDeItens(itens: ItemPedido[]): string[] {
  return itens
    .filter((i) => (i.status_item ?? "").toUpperCase() !== "CANCELADO")
    .map((i) => {
      const nome = limpar(i.nome_produto, 120) || "Produto";
      const qtd = Number(i.qtd);
      return Number.isFinite(qtd) && qtd > 0 ? `• ${qtd.toLocaleString("pt-BR")} x ${nome}` : `• ${nome}`;
    });
}

/** Mensagem padrão (editável depois, só aqui). */
export function montarMensagem(p: { nomeContato: string; idInt: number; itens: string[]; formaEnvio: string }): string {
  const nome = limpar(p.nomeContato) || "cliente";
  return [
    `Olá, ${nome}!`,
    `Seu pedido ${p.idInt} está pronto. ✅`,
    ...p.itens,
    `Forma de envio: ${p.formaEnvio}`,
    "Qualquer dúvida, é só responder esta mensagem."
  ].join("\n");
}

/** Aceite do message_send: HTTP 2xx + result "success" + code 201 + message_id. */
export function envioAceito(http: number, data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const ok =
    http >= 200 && http < 300 && d.result === "success" && Number(d.code) === 201 &&
    typeof d.message_id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(d.message_id);
  return ok ? (d.message_id as string) : null;
}

/** Recusa explícita do ChatGuru (nada saiu): result "error" + code 400 + HTTP < 500. */
export function envioRecusado(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return http < 500 && d.result === "error" && Number(d.code) === 400;
}
