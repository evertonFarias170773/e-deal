/**
 * Regras puras do aviso "pedido pronto" (sem rede, sem banco), para a Edge
 * Function e para o teste scripts/testes/expedicao-aviso-pronto.test.mts.
 */
import {
  IDS_CORREIOS,
  TRANSPORTADORAS_PARCEIRAS,
  resolverTransportadoraParceira
} from "../../../src/features/orcamentos/lib/transportadoras-parceiras.ts";

/**
 * Modo teste (06/11/2026, 2ª versão): só pedido do cliente #14, com contato do
 * cliente #14. O destino é o WhatsApp do contato como está no cadastro — não há
 * número fixo.
 */
export const CLIENTE_TESTE = 14;

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
 * Modo teste ligado: recusa no servidor todo pedido que não seja do cliente
 * #14 e todo contato que não seja do cliente #14 (o faturado pode ser outro
 * cliente, com gente real).
 */
export function conferirModoTeste(modoTeste: boolean, idClientePedido: unknown, idClienteContato?: unknown): void {
  if (!modoTeste) return;
  if (Number(idClientePedido) !== CLIENTE_TESTE) {
    throw new Recusa(403, `Modo teste: só pedidos do cliente #${CLIENTE_TESTE} podem ser avisados.`);
  }
  if (idClienteContato !== undefined && Number(idClienteContato) !== CLIENTE_TESTE) {
    throw new Recusa(403, `Modo teste: só contatos do cliente #${CLIENTE_TESTE} podem receber o aviso.`);
  }
}

/**
 * Recusa do ChatGuru por causa do número (ex.: "Chat não encontrado."): a tela
 * mostra o número enviado e oferece "Corrigir número". O Vibe não tenta outro
 * formato sozinho.
 */
export function recusaPorNumero(motivo: string | null | undefined): boolean {
  return /chat\s+n[aã]o\s+encontrad|n[uú]mero|telefone|chat_number|whats/i.test(motivo ?? "");
}

// ───────────────────────── Diálogos (07/11/2026) ─────────────────────────

export type CampoDialogo = "Pedido_Atual" | "Nota_Fiscal" | "Cidade_Destino" | "Sedex_Conhecimento";
export type NomeDialogo = "Sedex" | "Motoboy" | "Retira" | "Veppo" | "Azul" | "Transportadora";

/**
 * Diálogos criados pela diretoria no ChatGuru (Guia "Envio de WhatsApp por
 * diálogos ChatGuru", 07/11/2026). Configuração do servidor: a tela só vê o nome.
 * Os campos de cada um são os do template; nenhum se repete com o Link_do_Cliente
 * que o envio de arte do Imposition grava na mesma conversa.
 */
export const DIALOGOS: Record<NomeDialogo, { id: string; campos: readonly CampoDialogo[] }> = {
  Sedex: { id: "6aef26a47b47d7256c8924ae", campos: ["Sedex_Conhecimento", "Pedido_Atual", "Nota_Fiscal"] },
  Motoboy: { id: "6aef36709e91cf335ffdf6fd", campos: ["Pedido_Atual", "Nota_Fiscal"] },
  Retira: { id: "6aef3674e2ff0962de8545fc", campos: ["Pedido_Atual", "Nota_Fiscal"] },
  Veppo: { id: "6aef3678e11ead8b0e4f40b6", campos: ["Cidade_Destino", "Pedido_Atual", "Nota_Fiscal"] },
  Azul: { id: "6aef367de2ff0962de8545ff", campos: ["Pedido_Atual", "Nota_Fiscal", "Cidade_Destino"] },
  Transportadora: { id: "6aef36a7eab83021c5d20230", campos: ["Cidade_Destino", "Pedido_Atual", "Nota_Fiscal"] }
};

export function nomeDoDialogo(id: string | null | undefined): NomeDialogo | null {
  if (!id) return null;
  const achado = (Object.keys(DIALOGOS) as NomeDialogo[]).find((n) => DIALOGOS[n].id === id);
  return achado ?? null;
}

export const SEM_MODELO = "Sem modelo de mensagem para esta forma de envio.";
export const SEM_ETIQUETA = "Gere a etiqueta dos Correios antes.";

export type DespachoFrete = {
  tipo_frete?: string | null;
  modalidade_frete?: string | null;
  categoria_frete?: string | null;
  transportadora_nome?: string | null;
  id_transportadora_cliente?: number | string | null;
};

export type OrcamentoFrete = {
  modalidade_frete?: string | null;
  categoria_frete?: string | null;
  id_transportadora_cliente?: number | string | null;
  /** Nome do cadastro de propostas.id_transportadora_cliente. */
  nomeTransportadora?: string | null;
  /** cotacao_frete.servico da cotação escolhida (ou propostas.frete_escolhido). */
  servicoCotacao?: string | null;
};

export type EntradaDialogo = {
  /** expedicoes do pedido; só vale quando o expedidor já declarou o tipo_frete. */
  despacho: DespachoFrete | null;
  orcamento: OrcamentoFrete;
  /** Código de rastreio dos Correios válido (prepostagem não cancelada). */
  rastreioCorreios: string | null;
};

export type EscolhaDialogo = { dialogo: NomeDialogo | null; bloqueio: string | null; origem: "despacho" | "orcamento" | null };

function normalizar(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Serviço dos Correios dito no texto: SEDEX, PAC ou nenhum (fronteira de palavra). */
export function servicoCorreios(...textos: (string | null | undefined)[]): "SEDEX" | "PAC" | null {
  const t = textos.map(normalizar).join(" ");
  if (/(^|[^A-Z])PAC([^A-Z]|$)/.test(t)) return "PAC";
  if (/(^|[^A-Z])SEDEX([^A-Z]|$)/.test(t)) return "SEDEX";
  return null;
}

/** Código de objeto dos Correios: 2 letras, 9 dígitos, 2 letras. */
export function rastreioCorreiosValido(...codigos: (string | null | undefined)[]): string | null {
  for (const c of codigos) {
    const v = (c ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(v)) return v;
  }
  return null;
}

type Forma = NomeDialogo | "CORREIOS" | null;

const ehCorreiosId = (id: unknown) => IDS_CORREIOS.includes(Number(id));

function formaDoDespacho(d: DespachoFrete): Forma | undefined {
  const tipo = normalizar(d.tipo_frete);
  if (!tipo) return undefined; // expedidor ainda não declarou: vale o orçamento
  if (tipo === "RETIRA_BALCAO" || normalizar(d.modalidade_frete) === "RETIRA") return "Retira";
  if (tipo === "MOTOBOY") return "Motoboy";
  if (tipo === "CORREIOS") return "CORREIOS";
  if (tipo === "TRANSPORTADORA") {
    const parceira = resolverTransportadoraParceira({ transportadora: d.transportadora_nome, servico: null });
    const id = Number(d.id_transportadora_cliente);
    if (parceira === TRANSPORTADORAS_PARCEIRAS.VEPPO || id === TRANSPORTADORAS_PARCEIRAS.VEPPO || normalizar(d.categoria_frete) === "VEPPO") {
      return "Veppo";
    }
    if (parceira === TRANSPORTADORAS_PARCEIRAS.CORREIOS || ehCorreiosId(id)) return "CORREIOS";
    if (parceira === TRANSPORTADORAS_PARCEIRAS.MOTOBOY) return "Motoboy";
    if (parceira === TRANSPORTADORAS_PARCEIRAS.AZUL) return "Azul";
    return "Transportadora";
  }
  return undefined;
}

function formaDoOrcamento(o: OrcamentoFrete): Forma {
  const modalidade = normalizar(o.modalidade_frete);
  if (modalidade === "RETIRA") return "Retira";
  const servico = normalizar(o.servicoCotacao);
  // Cotação de balcão vence CIF (mesma regra do modal de despacho); FOB é escolha explícita.
  if (modalidade !== "FOB" && (servico.includes("RETIRA") || servico.includes("BALCAO"))) return "Retira";
  const parceira = resolverTransportadoraParceira({ transportadora: o.nomeTransportadora, servico: o.servicoCotacao });
  const id = Number(o.id_transportadora_cliente);
  if (parceira === TRANSPORTADORAS_PARCEIRAS.CORREIOS || ehCorreiosId(id)) return "CORREIOS";
  if (parceira === TRANSPORTADORAS_PARCEIRAS.MOTOBOY) return "Motoboy";
  if (parceira === TRANSPORTADORAS_PARCEIRAS.VEPPO || id === TRANSPORTADORAS_PARCEIRAS.VEPPO) return "Veppo";
  if (parceira === TRANSPORTADORAS_PARCEIRAS.AZUL) return "Azul";
  if (parceira === TRANSPORTADORAS_PARCEIRAS.SAO_MIGUEL) return "Transportadora";
  if (Number.isFinite(id) && id > 0) return "Transportadora";
  const categoria = normalizar(o.categoria_frete);
  if (categoria === "VEPPO") return "Veppo";
  if (categoria === "RODOVIARIO" || categoria === "AEREO") return "Transportadora";
  return null;
}

/**
 * Diálogo pela forma de envio. A do despacho (o que o expedidor declarou em
 * expedicoes.tipo_frete) vence a do orçamento. Correios só com SEDEX — PAC ou
 * serviço não dito não tem modelo — e SEDEX só com rastreio. Forma que não se
 * encaixa fica sem modelo: nunca se usa outro diálogo no lugar.
 */
export function escolherDialogo(e: EntradaDialogo): EscolhaDialogo {
  const doDespacho = e.despacho ? formaDoDespacho(e.despacho) : undefined;
  const origem = doDespacho !== undefined ? "despacho" : "orcamento";
  const forma = doDespacho !== undefined ? doDespacho : formaDoOrcamento(e.orcamento);
  if (forma === null) return { dialogo: null, bloqueio: SEM_MODELO, origem };
  if (forma === "CORREIOS") {
    // O serviço dito no despacho vence o da cotação.
    const servico =
      (origem === "despacho" ? servicoCorreios(e.despacho?.transportadora_nome) : null) ??
      servicoCorreios(e.orcamento.servicoCotacao);
    if (servico !== "SEDEX") return { dialogo: null, bloqueio: SEM_MODELO, origem };
    if (!e.rastreioCorreios) return { dialogo: "Sedex", bloqueio: SEM_ETIQUETA, origem };
    return { dialogo: "Sedex", bloqueio: null, origem };
  }
  return { dialogo: forma, bloqueio: null, origem };
}

/** Número(s) da nota autorizada: "7501" ou "7501, 7502"; sem nota, "—". */
export function numeroDaNota(numeros: (string | number | null | undefined)[]): string {
  const lista = Array.from(new Set(numeros.map((n) => String(n ?? "").trim()).filter((n) => /^\d{1,15}$/.test(n))));
  lista.sort((a, b) => Number(a) - Number(b));
  return lista.length ? lista.join(", ") : "—";
}

/** "Santa Cruz do Sul/RS"; sem cidade, null. */
export function cidadeDestino(cidade: string | null | undefined, uf: string | null | undefined): string | null {
  const c = limpar(cidade, 80);
  const u = limpar(uf, 2).toUpperCase();
  if (!c) return null;
  return /^[A-Z]{2}$/.test(u) ? `${c}/${u}` : c;
}

/**
 * Campos do diálogo, prontos para chat_update_custom_fields (field__<Nome>).
 * Campo que o diálogo pede e não tem valor recusa aqui, antes de qualquer envio.
 */
export function camposDoDialogo(
  dialogo: NomeDialogo,
  v: { idInt: number; notaFiscal: string; cidadeDestino: string | null; rastreio: string | null }
): Record<string, string> {
  const valores: Record<CampoDialogo, string | null> = {
    Pedido_Atual: String(v.idInt),
    Nota_Fiscal: v.notaFiscal || "—",
    Cidade_Destino: v.cidadeDestino,
    Sedex_Conhecimento: v.rastreio
  };
  const campos: Record<string, string> = {};
  for (const nome of DIALOGOS[dialogo].campos) {
    const valor = valores[nome];
    if (!valor) {
      if (nome === "Sedex_Conhecimento") throw new Recusa(409, SEM_ETIQUETA);
      if (nome === "Cidade_Destino") throw new Recusa(422, "O pedido não tem cidade de entrega. Confira o endereço de entrega.");
      throw new Recusa(422, `Campo ${nome} sem valor.`);
    }
    campos[`field__${nome}`] = valor;
  }
  return campos;
}

/** chat_update_custom_fields aceito: HTTP 2xx + result "success" + code 200. */
export function camposAceitos(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return http >= 200 && http < 300 && d.result === "success" && Number(d.code) === 200;
}

/** dialog_execute: sucesso = 2xx + success + code 200 + "Diálogo executado". Não há message_id. */
export function dialogoExecutado(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return camposAceitos(http, d) && /di[aá]logo\s+executado/i.test(String(d.description ?? ""));
}

/** Recusa explícita do ChatGuru (nada saiu): result "error" + code 400 + HTTP < 500. */
export function envioRecusado(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return http < 500 && d.result === "error" && Number(d.code) === 400;
}

/** Chave da conversa do contrato: SHA-256 (hex) de JSON.stringify([endpoint, account_id, phone_id, numero]). */
export async function chaveDaConversa(endpoint: string, account: string, phone: string, numero: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([endpoint, account, phone, numero])));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function limpar(texto: unknown, max = 150): string {
  if (typeof texto !== "string") return "";
  // deno-lint-ignore no-control-regex
  return texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
