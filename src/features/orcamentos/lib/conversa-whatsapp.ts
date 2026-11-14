/**
 * Comprador da aba Artes pela conversa do WhatsApp (10/11/2026, decisão do Everton).
 *
 * A visão chatguru_contatos_3478 (conversas do remetente 3478 com
 * codigo_cliente = id_cliente) é só para falar com o cliente pelo WhatsApp; a
 * tabela contatos continua sendo o cadastro da pessoa. O Comprador passa a ser
 * uma conversa do Guru do cliente, gravada em `propostas.chatguru_chat_id`.
 *
 * Regra do primeiro "Enviar para arte": conversa com nome e número. Uma conversa
 * só já vem escolhida; com várias, o usuário escolhe; sem conversa, o envio fica
 * apagado. Pedido já enviado para arte não é travado (arteJaEnviada).
 */

export type ConversaWhatsapp = { chat_id: string; nome: string; numero: string };

/** Conversa escolhida como contato do pedido (14/11/2026). A principal é o Comprador. */
export type ContatoEscolhido = ConversaWhatsapp & { principal: boolean };

/** Mensagem da trava (Enviar para arte e Liberação para produção) quando o cliente não tem conversa. */
export const SEM_CONVERSA_NO_GURU =
  "Cadastre a conversa no ChatGuru: o cliente não tem conversa no WhatsApp da Ideal. Peça ao atendimento para abrir a conversa com o código do cliente no nome";

/**
 * A escolha da aba Geral, limpa: sem repetição, na ordem em que veio, e com a
 * principal dentro do conjunto (principal ausente ou fora dele = a primeira).
 * Nenhuma conversa = null.
 */
export function escolhaDeContatos(chatIds: readonly string[], principal: string | null | undefined): { chatIds: string[]; principal: string } | null {
  const lista = Array.from(new Set(chatIds.map((c) => String(c ?? "").trim()).filter(Boolean)));
  if (lista.length === 0) return null;
  const p = String(principal ?? "").trim();
  return { chatIds: lista, principal: lista.includes(p) ? p : lista[0] };
}

/** Chave de comparação de telefone: DDD + os 8 últimos dígitos (o 9 e o 55 não contam). */
export function chaveDoTelefone(valor: unknown): string | null {
  let n = typeof valor === "string" || typeof valor === "number" ? String(valor).replace(/\D/g, "") : "";
  if ((n.length === 12 || n.length === 13) && n.startsWith("55")) n = n.slice(2);
  if (n.length !== 10 && n.length !== 11) return null;
  return `${n.slice(0, 2)}${n.slice(-8)}`;
}

export function mesmoTelefone(a: unknown, b: unknown): boolean {
  const ka = chaveDoTelefone(a);
  return ka !== null && ka === chaveDoTelefone(b);
}

/** Número como o ChatGuru guarda: DDI 55 + DDD + número (com ou sem o 9). */
export function numeroDaConversa(valor: unknown): string | null {
  const n = typeof valor === "string" ? valor.replace(/\D/g, "") : "";
  return /^55[1-9]\d{9,10}$/.test(n) ? n : null;
}

/** "(51) 99101-0423" a partir de "5551991010423"; sem formato conhecido, o número cru. */
export function numeroParaExibir(numero: string): string {
  const n = numero.replace(/\D/g, "").replace(/^55/, "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return numero;
}

function nomeValido(nome: string | null | undefined): boolean {
  const t = String(nome ?? "").trim();
  return t !== "" && t !== "—";
}

export type SituacaoDaConversa = {
  conversas: ConversaWhatsapp[];
  /** A gravada (se ainda é do cliente) ou a única conversa do cliente. */
  escolhida: ConversaWhatsapp | null;
  /** A escolhida veio da proposta (true) ou é a única, ainda não gravada (false). */
  gravada: boolean;
  precisaEscolher: boolean;
  semConversa: boolean;
  liberado: boolean;
  aviso: string | null;
};

export function situacaoDaConversa(conversas: readonly ConversaWhatsapp[], idGravado: string | null | undefined): SituacaoDaConversa {
  const lista = conversas.filter((c) => c.chat_id && numeroDaConversa(c.numero));
  const id = String(idGravado ?? "").trim();
  const salva = id ? lista.find((c) => c.chat_id === id) ?? null : null;
  const escolhida = salva ?? (lista.length === 1 ? lista[0] : null);
  const base = { conversas: lista, escolhida, gravada: Boolean(salva) };
  if (lista.length === 0) {
    return { ...base, precisaEscolher: false, semConversa: true, liberado: false, aviso: SEM_CONVERSA_NO_GURU };
  }
  if (!escolhida) {
    return {
      ...base,
      precisaEscolher: true,
      semConversa: false,
      liberado: false,
      aviso: `O cliente tem ${lista.length} conversas no ChatGuru. Escolha qual recebe a arte.`
    };
  }
  if (!nomeValido(escolhida.nome)) {
    return {
      ...base,
      precisaEscolher: false,
      semConversa: false,
      liberado: false,
      aviso: "A conversa escolhida está sem nome no ChatGuru. Peça ao atendimento para pôr o nome com o código do cliente."
    };
  }
  return { ...base, precisaEscolher: false, semConversa: false, liberado: true, aviso: null };
}
