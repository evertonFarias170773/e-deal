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
 * mostra o número usado e oferece "Ver conversas do cliente" (09/11/2026). O
 * Vibe não tenta outro número sozinho.
 */
export function recusaPorNumero(motivo: string | null | undefined): boolean {
  return /chat\s+n[aã]o\s+encontrad|n[uú]mero|telefone|chat_number|whats/i.test(motivo ?? "");
}

// --- Diálogos (07/11/2026) ---

export type CampoDialogo = "Pedido_Atual" | "Nota_Fiscal" | "Cidade_Destino" | "Sedex_Conhecimento" | "Transportadora";
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
  // v26 (13/11/2026): o modelo do Transportadora ganhou o campo Transportadora (nome curto).
  Transportadora: { id: "6aef36a7eab83021c5d20230", campos: ["Cidade_Destino", "Pedido_Atual", "Nota_Fiscal", "Transportadora"] }
};

export function nomeDoDialogo(id: string | null | undefined): NomeDialogo | null {
  if (!id) return null;
  const achado = (Object.keys(DIALOGOS) as NomeDialogo[]).find((n) => DIALOGOS[n].id === id);
  return achado ?? null;
}

/**
 * Aviso "Pedido em Produção" (07/11/2026), na liberação para a produção. Diálogo
 * sem campos personalizados (dono, 07/11): só dialog_execute.
 */
export const DIALOGO_PRODUCAO = "6071c6dbe34a18c2cc684747";

/**
 * Nome curto da transportadora para o campo Transportadora do diálogo (v26,
 * 13/11/2026, lista aprovada pelo Everton): o cadastro de várias só tem a razão
 * social. Fora da lista, sai o nome gravado (a fantasia do despacho).
 */
export const NOMES_CURTOS_TRANSPORTADORA: Readonly<Record<number, string>> = {
  120026: "São Miguel",
  120027: "São Miguel",
  796: "Troca",
  70010: "Melhor Envio",
  120009: "Braspress",
  120011: "Braspress",
  925: "Jamef",
  120005: "Atual Cargas",
  70009: "TW Transportes",
  120006: "Avi Azul"
};

export function nomeCurtoTransportadora(id: unknown, nomeGravado: string | null | undefined): string | null {
  const curto = NOMES_CURTOS_TRANSPORTADORA[Number(id)];
  if (curto) return curto;
  return limpar(nomeGravado, 80) || null;
}

export const SEM_TRANSPORTADORA = "O pedido não tem transportadora no despacho. Confira a transportadora antes de avisar.";

export const SEM_MODELO = "Sem modelo de mensagem para esta forma de envio.";
export const SEM_ETIQUETA = "Gere a etiqueta dos Correios antes.";

/**
 * Status em que o aviso de pedido pronto pode sair. Até 10/11/2026 só na bancada
 * (EXPEDICAO). Desde a v23 o aviso sai no clique do "Confirmar despacho", logo
 * DEPOIS de gravar o despacho, e o despacho já mudou o status: SEDEX e PAC vão
 * para EM TRANSITO, a retirada para A RETIRAR (transportadora e motoboy seguem em
 * EXPEDICAO esperando a coleta). O reenvio pelo menu do card vale nos mesmos três.
 */
export const STATUS_AVISO_PRONTO = ["EXPEDICAO", "A RETIRAR", "EM TRANSITO"] as const;

export function statusPermiteAvisoPronto(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return (STATUS_AVISO_PRONTO as readonly string[]).includes(s);
}

/**
 * Forma de envio que está na janela do despacho, ainda não gravada (v23,
 * acao "preparar"). Só serve para a janela mostrar o modelo antes de confirmar;
 * o envio de verdade relê o que o despacho gravou.
 */
export type DespachoDaTela = {
  despacho: DespachoFrete;
  rastreio: string | null;
  idEnderecoEntrega: string | null;
};

export function despachoDaTela(v: unknown): DespachoDaTela | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const texto = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "") || null;
  const id = Number(o.id_transportadora_cliente);
  const endereco = texto(o.id_endereco_entrega, 40);
  return {
    despacho: {
      tipo_frete: texto(o.tipo_frete, 40),
      modalidade_frete: texto(o.modalidade_frete, 20),
      categoria_frete: texto(o.categoria_frete, 40),
      transportadora_nome: texto(o.transportadora_nome, 120),
      id_transportadora_cliente: Number.isInteger(id) && id > 0 ? id : null
    },
    rastreio: texto(o.rastreio, 40),
    idEnderecoEntrega: endereco && /^[0-9a-f-]{36}$/i.test(endereco) ? endereco : null
  };
}

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
    if (parceira === TRANSPORTADORAS_PARCEIRAS.AZUL || id === TRANSPORTADORAS_PARCEIRAS.AZUL) return "Azul";
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
  if (parceira === TRANSPORTADORAS_PARCEIRAS.AZUL || id === TRANSPORTADORAS_PARCEIRAS.AZUL) return "Azul";
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

/**
 * Nota_Fiscal do diálogo. Pedido marcado como faturado no sistema antigo
 * (propostas.faturado_fora_em) usa expedicoes.nf_numero_manual, só os dígitos
 * ("41.030" -> "41030"); sem número manual, vale a nota autorizada do Vibe.
 */
export function notaParaODialogo(e: {
  faturadoNoSistemaAntigo: boolean;
  nfNumeroManual: string | null | undefined;
  numerosDoVibe: (string | number | null | undefined)[];
}): string {
  const manual = String(e.nfNumeroManual ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (e.faturadoNoSistemaAntigo && /^\d{1,15}$/.test(manual)) return manual;
  return numeroDaNota(e.numerosDoVibe);
}

/** "Santa Cruz do Sul/RS"; sem cidade, null. */
/**
 * Transportadora do aviso: a do despacho (o que o expedidor declarou) vence a do
 * orçamento. Só o diálogo Transportadora usa o campo.
 */
export function transportadoraDoAviso(e: EntradaDialogo, escolha: EscolhaDialogo): string | null {
  const doDespacho =
    escolha.origem === "despacho" && e.despacho
      ? nomeCurtoTransportadora(e.despacho.id_transportadora_cliente, e.despacho.transportadora_nome)
      : null;
  return doDespacho ?? nomeCurtoTransportadora(e.orcamento.id_transportadora_cliente, e.orcamento.nomeTransportadora);
}

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
  v: { idInt: number; notaFiscal: string; cidadeDestino: string | null; rastreio: string | null; transportadora?: string | null }
): Record<string, string> {
  const valores: Record<CampoDialogo, string | null> = {
    Pedido_Atual: String(v.idInt),
    Nota_Fiscal: v.notaFiscal || "—",
    Cidade_Destino: v.cidadeDestino,
    Sedex_Conhecimento: v.rastreio,
    Transportadora: v.transportadora ?? null
  };
  const campos: Record<string, string> = {};
  for (const nome of DIALOGOS[dialogo].campos) {
    const valor = valores[nome];
    if (!valor) {
      if (nome === "Sedex_Conhecimento") throw new Recusa(409, SEM_ETIQUETA);
      if (nome === "Cidade_Destino") throw new Recusa(422, "O pedido não tem cidade de entrega. Confira o endereço de entrega.");
      if (nome === "Transportadora") throw new Recusa(422, SEM_TRANSPORTADORA);
      throw new Recusa(422, `Campo ${nome} sem valor.`);
    }
    campos[`field__${nome}`] = valor;
  }
  return campos;
}

// --- Testar modelo (07/11/2026) ---

/** Os seis diálogos na ordem da tela. */
export const NOMES_DIALOGO = Object.keys(DIALOGOS) as NomeDialogo[];

export function dialogoValido(nome: unknown): NomeDialogo | null {
  return typeof nome === "string" && (NOMES_DIALOGO as string[]).includes(nome) ? (nome as NomeDialogo) : null;
}

/** Valores de teste para o campo que o pedido não tem (Nota_Fiscal sem nota já é "—"). */
export const VALORES_TESTE = {
  Sedex_Conhecimento: "TESTE000000BR",
  Cidade_Destino: "Porto Alegre/RS",
  Nota_Fiscal: "—",
  Transportadora: "São Miguel"
} as const;

/**
 * "Testar modelo": só com o modo teste ligado e só para pedido (e contato) do
 * cliente #14. Fora disso a opção não existe e o servidor recusa.
 */
export function conferirTeste(modoTeste: boolean, idClientePedido: unknown, idClienteContato?: unknown): void {
  if (!modoTeste) throw new Recusa(403, "Testar modelo só existe com o modo teste ligado.");
  if (Number(idClientePedido) !== CLIENTE_TESTE) {
    throw new Recusa(403, `Testar modelo: só pedidos do cliente #${CLIENTE_TESTE}.`);
  }
  if (idClienteContato !== undefined && Number(idClienteContato) !== CLIENTE_TESTE) {
    throw new Recusa(403, `Testar modelo: só contatos do cliente #${CLIENTE_TESTE}.`);
  }
}

/**
 * Campos do diálogo escolhido no "Testar modelo", sem depender da forma de envio:
 * o que o pedido tem vai como está; o que não tem vai com o valor de teste.
 * `deTeste` lista os campos que foram com valor de teste.
 */
export function camposDeTeste(
  dialogo: NomeDialogo,
  v: { idInt: number; notaFiscal: string; cidadeDestino: string | null; rastreio: string | null; transportadora?: string | null }
): { campos: Record<string, string>; valores: Partial<Record<CampoDialogo, string>>; deTeste: CampoDialogo[] } {
  const doPedido: Record<CampoDialogo, string | null> = {
    Pedido_Atual: String(v.idInt),
    Nota_Fiscal: v.notaFiscal && v.notaFiscal !== "—" ? v.notaFiscal : null,
    Cidade_Destino: v.cidadeDestino,
    Sedex_Conhecimento: v.rastreio,
    Transportadora: v.transportadora ?? null
  };
  const campos: Record<string, string> = {};
  const valores: Partial<Record<CampoDialogo, string>> = {};
  const deTeste: CampoDialogo[] = [];
  for (const nome of DIALOGOS[dialogo].campos) {
    let valor = doPedido[nome];
    if (!valor) {
      valor = (VALORES_TESTE as Record<string, string>)[nome] ?? null;
      if (!valor) throw new Recusa(422, `Campo ${nome} sem valor.`);
      deTeste.push(nome);
    }
    campos[`field__${nome}`] = valor;
    valores[nome] = valor;
  }
  return { campos, valores, deTeste };
}

/** chat_update_custom_fields aceito: HTTP 2xx + result "success" + code 200. */
export function camposAceitos(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return http >= 200 && http < 300 && d.result === "success" && Number(d.code) === 200;
}

/**
 * dialog_execute: sucesso = 2xx + success + code 200 + "Diálogo executado". Não há message_id.
 * Resposta real do ChatGuru (07/11/2026, teste Sedex no 24880):
 *   {"code":200,"dialog_execution_return":"Diálogo Executado","result":"success"}
 * O texto vem em dialog_execution_return (não em description); os dois são aceitos.
 */
export function dialogoExecutado(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  const texto = `${String(d.dialog_execution_return ?? "")} ${String(d.description ?? "")}`;
  return camposAceitos(http, d) && /di[aá]logo\s+executado/i.test(texto);
}

/** Texto do ChatGuru que explica a resposta: description ou dialog_execution_return. */
export function textoDaResposta(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  return limpar(d.description, 200) || limpar(d.dialog_execution_return, 200);
}

/**
 * Regra dos 120 segundos (09/11/2026): o ChatGuru recusa um segundo diálogo na mesma
 * conversa antes de 2 minutos, com HTTP 200, code 200 e result "error":
 *   "Diálogo não foi executado pois o tempo mínimo não foi atingido: Tempo decorrido: 63 segs - Mínimo: 120 segs"
 * Nada sai: é recusa explícita (estado 'falhou', conversa liberada), não incerteza.
 */
export const TEMPO_MINIMO_GURU = "O ChatGuru exige 2 minutos entre mensagens para a mesma conversa. Tente de novo em instantes.";

export function recusaTempoMinimo(data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  const texto = `${String(d.dialog_execution_return ?? "")} ${String(d.description ?? "")}`;
  return d.result === "error" && /tempo\s+m[ií]nimo/i.test(texto);
}

/** Recusa explícita do ChatGuru (nada saiu): result "error" + code 400 + HTTP < 500, ou a regra dos 120 s. */
export function envioRecusado(http: number, data: unknown): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  return http < 500 && d.result === "error" && (Number(d.code) === 400 || recusaTempoMinimo(d));
}

/** Respostas do "Liberar número" (ADM, depois de conferir no ChatGuru) e o estado que cada uma dá. */
export const LIBERACAO: Record<"enviada" | "nao_enviada", "executado" | "falhou"> = {
  enviada: "executado",
  nao_enviada: "falhou"
};

// Chaves que nunca vão para o diagnóstico: credenciais e dados do contato.
const CHAVES_SENSIVEIS = /key|token|secret|senha|account|phone|chat_number|numero|number|name|nome|mail|whats|contat|contact/i;

/**
 * Texto da resposta do ChatGuru para diagnóstico (só ADM vê; nunca é gravado).
 * Sem as chaves sensíveis do JSON, sem os valores em `ocultar` (chave da API,
 * número, nome do contato) e sem sequência que pareça telefone.
 */
export function diagnosticoSeguro(texto: unknown, ocultar: (string | null | undefined)[] = [], max = 500): string {
  let saida = typeof texto === "string" ? texto : "";
  try {
    const limpo = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(limpo)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>)
                .filter(([k]) => !CHAVES_SENSIVEIS.test(k))
                .map(([k, x]) => [k, limpo(x)])
            )
          : v;
    saida = JSON.stringify(limpo(JSON.parse(saida)));
  } catch {
    /* não é JSON: vai o texto, com as mesmas máscaras */
  }
  for (const valor of ocultar) {
    const v = (valor ?? "").trim();
    if (v.length >= 3) saida = saida.split(v).join("[oculto]");
  }
  return saida
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[número]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

// --- Conversa do ChatGuru (09/11/2026, decisão da diretoria) ---
//
// O destino dos avisos sai da visão chatguru_contatos_3478 (conversas do remetente
// 3478, codigo_cliente = id_cliente do pedido), não mais de contatos.whats. Nenhum
// contato do Vibe é editado para isso.

export const SEM_CONVERSA = "Cliente sem conversa no ChatGuru (remetente 3478)";

export type Conversa = { chat_id: string; nome: string; numero: string };

/** DDD + 8 últimos dígitos (10 dígitos), sem DDI e sem o nono dígito; null se não dá para saber. */
export function dddFinal8(valor: unknown): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  let n = String(valor).replace(/\D/g, "").replace(/^0+/, "");
  if (/^55\d{10,11}$/.test(n)) n = n.slice(2);
  if (!/^[1-9]\d{9,10}$/.test(n)) return null;
  return n.slice(0, 2) + n.slice(-8);
}

/** Número da conversa como o ChatGuru guarda (DDI 55 + DDD + número, com ou sem o 9). */
export function numeroDaConversa(valor: unknown): string | null {
  const n = typeof valor === "string" ? valor.replace(/\D/g, "") : "";
  return /^55[1-9]\d{9,10}$/.test(n) ? n : null;
}

export type DecisaoConversa =
  | { modo: "automatica"; conversa: Conversa }
  | { modo: "escolha"; motivo: "varias" | "nenhuma"; conversas: Conversa[] }
  | { modo: "sem_conversa" };

/**
 * Regra: o telefone do contato responsável casa (DDD + 8 últimos) com exatamente
 * uma conversa do cliente -> envia para ela, sem perguntar. Casa com mais de uma,
 * ou com nenhuma, e o cliente tem conversas -> escolha na tela. Sem conversa -> não envia.
 * Conversa com número inválido fica fora.
 */
export function decidirConversa(telefoneContato: unknown, conversas: Conversa[]): DecisaoConversa {
  const validas = conversas.filter((c) => c.chat_id && numeroDaConversa(c.numero));
  if (!validas.length) return { modo: "sem_conversa" };
  const alvo = dddFinal8(telefoneContato);
  const casam = alvo ? validas.filter((c) => dddFinal8(c.numero) === alvo) : [];
  if (casam.length === 1) return { modo: "automatica", conversa: casam[0] };
  return { modo: "escolha", motivo: casam.length > 1 ? "varias" : "nenhuma", conversas: validas };
}

/**
 * Conversa escolhida na aba Artes (propostas.chatguru_chat_id, v24 de 10/11/2026):
 * só vale se ainda está entre as conversas do cliente, relidas agora. Saiu do
 * cliente (renomeada no Guru, por exemplo) ou vazia: null, e vale a regra de casar o telefone.
 */
export function conversaDaProposta(chatId: unknown, doCliente: Conversa[]): Conversa | null {
  const id = typeof chatId === "string" ? chatId.trim() : "";
  if (!id) return null;
  return doCliente.find((c) => c.chat_id === id && numeroDaConversa(c.numero)) ?? null;
}

/**
 * Conversas escolhidas na tela: só chat_id que está na lista do cliente, relida
 * na hora; sem repetição. Lista vazia ou chat_id de fora -> recusa.
 */
export function conversasEscolhidas(pedidas: unknown, doCliente: Conversa[], todas = false): Conversa[] {
  const validas = doCliente.filter((c) => c.chat_id && numeroDaConversa(c.numero));
  if (todas) {
    if (!validas.length) throw new Recusa(422, SEM_CONVERSA);
    return validas;
  }
  const ids = Array.isArray(pedidas) ? Array.from(new Set(pedidas.map((x) => String(x ?? "").trim()).filter(Boolean))) : [];
  if (!ids.length) throw new Recusa(400, "Escolha ao menos uma conversa do cliente.");
  const porId = new Map(validas.map((c) => [c.chat_id, c]));
  const fora = ids.filter((id) => !porId.has(id));
  if (fora.length) throw new Recusa(409, "Uma das conversas escolhidas não é deste cliente no ChatGuru. Abra a lista de novo.");
  return ids.map((id) => porId.get(id)!);
}

// --- Pedido em Produção: link do cliente e bloqueio (09/11/2026) ---
//
// O template do diálogo DIALOGO_PRODUCAO passou a usar {Link_do_Cliente}. Sem gravar
// o campo, o ChatGuru usa o último valor da conversa (no teste de 09/11, o link do
// 24880 chegou no aviso do 24917). Por isso o Vibe grava field__Link_do_Cliente com
// o link do próprio pedido antes do dialog_execute, montado como o Imposition monta.
// Desde 10/11/2026 o campo leva só o final do link (numero_pedido-token, ex.:
// 24880-30b9b9), como o envio de arte do Imposition grava: o template já tem o
// começo fixo https://imposition.ai-ideal.com.br/cliente/.

export const AVISO_PRODUCAO_EM_AJUSTE = "Envio de aviso de produção em ajuste";
export const SEM_LINK_APROVACAO = "Pedido sem link de aprovação";

/**
 * De 09/11 a 10/11/2026 o aviso de produção só saía no modo teste; com ele
 * desligado, "Envio de aviso de produção em ajuste". Desde 10/11/2026 (decisão
 * da diretoria, antes da trava compartilhada com o Imposition) o aviso sai para
 * o cliente real como o aviso da Expedição: esta conferência não recusa mais.
 * Fica para quem a chama; a constante fica para o histórico e o teste.
 */
export function conferirEnvioProducao(_modoTeste: boolean, _idClientePedido?: unknown): void {
  return;
}

// --- Modo homologação (10/11/2026) ---
//
// Com o modo teste ligado, pedido de cliente real (fora do #14) não é mais recusado
// nos dois avisos (pedido pronto e pedido em produção): a mensagem sai com os dados
// reais do pedido, mas SEMPRE para a conversa de teste do cliente #14 no remetente
// 3478 ("Edison Junior - 14"), nunca para o cliente. Os campos do diálogo (inclusive
// o Link_do_Cliente) só são gravados nessa conversa. A linha fica com
// envio_teste = true: não conta como aviso já enviado do pedido, e o aviso de
// verdade continua possível quando o modo teste for desligado.

export const CONVERSA_TESTE_NOME = "Edison Junior - 14";
export const TEXTO_HOMOLOGACAO = "Modo homologação: a mensagem vai para a conversa de teste do Edison, não para o cliente.";
export const CONVERSA_TESTE_OCUPADA = "Conversa de teste ocupada, tente em 2 minutos.";
export const SEM_CONVERSA_TESTE = "Conversa de teste do cliente #14 não encontrada no ChatGuru (remetente 3478). Nada foi enviado.";
/** Regra do ChatGuru: 120 s entre diálogos executados na mesma conversa. */
export const INTERVALO_GURU_MS = 120_000;

/** Homologação: modo teste ligado e pedido de cliente que não é o #14. */
export function emHomologacao(modoTeste: boolean, idClientePedido: unknown): boolean {
  return modoTeste && Number(idClientePedido) !== CLIENTE_TESTE;
}

/** A conversa de teste entre as do cliente #14: a única, ou a única com o nome dela. */
export function conversaDeTeste(lista: Conversa[]): Conversa {
  if (lista.length === 1) return lista[0];
  const porNome = lista.filter((c) => c.nome.trim() === CONVERSA_TESTE_NOME);
  if (porNome.length === 1) return porNome[0];
  throw new Recusa(422, SEM_CONVERSA_TESTE);
}

/**
 * Regra dos 2 minutos na conversa de teste: há envio em andamento nela, ou o último
 * diálogo executado nela foi há menos de 120 s. O aviso é recusado antes de reservar
 * (nada é gravado nem travado).
 */
export function conversaTesteOcupada(p: { emAndamento: boolean; ultimoExecutadoEm: string | null | undefined; agoraMs: number }): boolean {
  if (p.emAndamento) return true;
  if (!p.ultimoExecutadoEm) return false;
  const t = Date.parse(p.ultimoExecutadoEm);
  return Number.isFinite(t) && p.agoraMs - t < INTERVALO_GURU_MS;
}

/**
 * Final do link de aprovação do pedido para o campo Link_do_Cliente, no formato do
 * Imposition (numero_pedido-token, sem o começo https://imposition.ai-ideal.com.br/cliente/,
 * que é fixo no template): linhas ativas de pedidos_links_cliente com os_id
 * "vibe_<id_int>"; exatamente uma, do próprio pedido, com token de 6 a 12
 * letras/dígitos. Nunca gera token novo.
 */
export function linkDoCliente(idInt: number, linhas: { numero_pedido?: unknown; token?: unknown }[] | null | undefined): string {
  const ativas = linhas ?? [];
  if (ativas.length !== 1) throw new Recusa(422, SEM_LINK_APROVACAO);
  const numero = String(ativas[0].numero_pedido ?? "").trim();
  const token = String(ativas[0].token ?? "").trim();
  if (!/^[1-9]\d*$/.test(numero) || numero !== String(idInt) || !/^[a-zA-Z0-9]{6,12}$/.test(token)) {
    throw new Recusa(422, SEM_LINK_APROVACAO);
  }
  return `${numero}-${token}`;
}

/**
 * v26 (13/11/2026): só no aviso Colocando em Produção (DIALOGO_PRODUCAO) o
 * Link_do_Cliente leva a âncora da aba Arte, ex.: 25220-h42mny#arte. O envio de
 * arte do Imposition grava o campo do jeito dele; nada muda lá.
 */
export const ANCORA_ARTE = "#arte";

export function linkDoAvisoProducao(finalDoLink: string): string {
  return `${finalDoLink}${ANCORA_ARTE}`;
}

// --- Orçamento pelo WhatsApp (v27, 13/11/2026) ---

/**
 * Diálogo "Orçamento Whatsapp" criado pelo Edinão em 13/11/2026: o campo Orcamento
 * leva o texto do box 9 da proposta (propostas.texto_whatsapp, gravado no Salvar),
 * com as quebras de linha como estão.
 */
export const DIALOGO_ORCAMENTO = "6aef91d13ce8e563d886694f";

/** Corpo de uma mensagem modelo do WhatsApp: até 1.024 caracteres. */
export const LIMITE_ORCAMENTO = 1024;

export const SEM_TEXTO_ORCAMENTO = "A proposta não tem o texto do orçamento gravado. Salve a proposta antes de enviar.";

export const CONVERSA_TRAVADA =
  "Há um aviso sem confirmação nesta conversa. Nada foi enviado. Ela fica travada até o ADM usar Liberar número na Expedição.";

/**
 * Texto do campo Orcamento: o do box 9 sem mudar a diagramação. Só troca \r\n por
 * \n, tira caracteres de controle (menos a quebra de linha) e espaços no fim.
 */
export function textoDoOrcamento(texto: unknown): string {
  if (typeof texto !== "string") throw new Recusa(422, SEM_TEXTO_ORCAMENTO);
  const t = texto
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\s+$/, "");
  if (!t.trim()) throw new Recusa(422, SEM_TEXTO_ORCAMENTO);
  if (t.length > LIMITE_ORCAMENTO) {
    throw new Recusa(422, `O texto do orçamento tem ${t.length} caracteres; o limite da mensagem do WhatsApp é ${LIMITE_ORCAMENTO}. Nada foi enviado.`);
  }
  return t;
}

/** Segundos que faltam para a regra dos 120 s do ChatGuru liberar a conversa (0 = livre). */
export function segundosParaLiberar(ultimoExecutadoEm: string | null | undefined, agoraMs: number): number {
  if (!ultimoExecutadoEm) return 0;
  const t = Date.parse(ultimoExecutadoEm);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t + INTERVALO_GURU_MS - agoraMs) / 1000));
}
