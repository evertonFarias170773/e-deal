import { diagnosticarTelefone, normalizarTelefoneBR, soDigitos } from "@/lib/telefone/telefone-br";
import { formatPhoneBR } from "@/lib/formatters/phone";

/**
 * TELEFONE DO DESTINATARIO EDITAVEL NO DESPACHO (21/10/2026).
 *
 * O telefone do modal vem do CADASTRO do destinatario (`clientes.whatsapp_1`, depois `telefone_fixo`,
 * regra unica em `telefone-destinatario.ts`) e muitas vezes esta errado. Quem tem `cadastros.edit`
 * corrige no proprio modal; ao confirmar, o numero novo vai para `clientes.whatsapp_1` do DESTINATARIO
 * que o modal mostra (pagador, cliente ou o escolhido em `id_cliente_destinatario_etiqueta` — nunca "o
 * cliente do pedido" por padrao), pelo caminho que ja existe, normalizado com `normalizarTelefoneBR`.
 * A etiqueta e a prepostagem releem o cadastro, entao saem com o numero novo; prepostagem que ja
 * congelou um telefone nao e alterada.
 *
 * Aqui ficam so as decisoes puras e a sequencia de gravacao (testaveis sem tela nem banco).
 */

export type ChaveTelefone = "whatsapp_1" | "telefone_fixo" | "whatsapp_2";
export type TelefonesDoCadastro = { whatsapp1: string; telefoneFixo: string; whatsapp2: string };
export type OpcaoTelefone = {
  chave: ChaveTelefone;
  rotulo: string;
  /** O que esta gravado no cadastro, cru. */
  numero: string;
  /** Formatado para o seletor. */
  exibido: string;
  /** "sem DDD" (menos de 10 digitos), "inválido" (outro defeito) ou null quando serve. */
  defeito: "sem DDD" | "inválido" | null;
};

/**
 * Os telefones PREENCHIDOS do cadastro do destinatario, para o seletor do Fone. Preenchido = tem ao menos
 * um digito (nome de pessoa no campo, comum em `whatsapp_1`, nao e telefone e nao entra). Menos de 10
 * digitos aparece como "sem DDD". A ordem e a de sempre: WhatsApp 1, Telefone fixo comercial, WhatsApp 2.
 */
export function opcoesDeTelefone(telefones: TelefonesDoCadastro | null | undefined): OpcaoTelefone[] {
  if (!telefones) return [];
  const fontes: Array<[ChaveTelefone, string, string]> = [
    ["whatsapp_1", "WhatsApp 1", telefones.whatsapp1],
    ["telefone_fixo", "Telefone fixo comercial", telefones.telefoneFixo],
    ["whatsapp_2", "WhatsApp 2", telefones.whatsapp2]
  ];
  const opcoes: OpcaoTelefone[] = [];
  for (const [chave, rotulo, numero] of fontes) {
    const digitos = soDigitos(numero);
    if (!digitos) continue;
    opcoes.push({
      chave,
      rotulo,
      numero,
      exibido: formatPhoneBR(numero),
      defeito: normalizarTelefoneBR(numero) ? null : digitos.length < 10 ? "sem DDD" : "inválido"
    });
  }
  return opcoes;
}

/**
 * Qual opcao comeca selecionada: a que a regra unica (`telefoneDestinatario`) escolhe hoje — a primeira entre
 * WhatsApp 1 e Telefone fixo cujo numero formatado e o do modal. Sem coincidencia, a primeira da lista.
 */
export function chaveInicialDoTelefone(opcoes: OpcaoTelefone[], telefoneDaRegra: string): ChaveTelefone | null {
  const alvo = soDigitos(telefoneDaRegra);
  if (alvo) {
    const daRegra = opcoes.find((o) => o.chave !== "whatsapp_2" && soDigitos(o.exibido) === alvo);
    if (daRegra) return daRegra.chave;
  }
  return opcoes[0]?.chave ?? null;
}

/** O seletor so aparece quando ha mais de um telefone para escolher. */
export function mostraSeletorDeTelefone(opcoes: OpcaoTelefone[]): boolean {
  return opcoes.length > 1;
}

export type AvaliacaoTelefone = {
  /** O texto digitado, sem nada. Vazio nunca grava (nao se apaga telefone por aqui). */
  alterado: boolean;
  valido: boolean;
  /** So digitos, com DDD, pronto para gravar; vazio se invalido. */
  normalizado: string;
  /** Mensagem para o expedidor quando alterou e esta invalido. */
  erro: string | null;
  /** O botao de confirmar fica bloqueado. */
  bloqueia: boolean;
  /** Ha o que gravar no cadastro: alterado, valido e quem edita tem permissao. */
  gravar: boolean;
};

export function avaliarTelefoneEditado(entrada: {
  /** O telefone que o modal mostrou ao abrir (do cadastro), em qualquer formatacao. */
  original: string;
  editado: string;
  podeEditar: boolean;
}): AvaliacaoTelefone {
  const digitosEditados = soDigitos(entrada.editado);
  const digitosOriginais = soDigitos(entrada.original);
  const normalizado = normalizarTelefoneBR(entrada.editado);
  // Vazio = sem alteracao. Igual ao que ja estava (mesmos digitos, ou o normalizado igual) = sem alteracao.
  // Texto SEM nenhum digito (letras) e alteracao invalida: bloqueia em vez de passar por "vazio".
  const preenchido = entrada.editado.trim() !== "";
  const alterado = preenchido && (digitosEditados === "" || (digitosEditados !== digitosOriginais && normalizado !== digitosOriginais));
  const valido = normalizado !== "";
  const erro =
    entrada.podeEditar && alterado && !valido
      ? diagnosticarTelefone(entrada.editado) ?? "não é um telefone brasileiro válido"
      : null;
  return {
    alterado,
    valido,
    normalizado: valido ? normalizado : "",
    erro,
    bloqueia: Boolean(erro),
    gravar: entrada.podeEditar && alterado && valido
  };
}

/**
 * A avaliacao do que o expedidor ESCOLHEU/DIGITOU. A comparacao e com o `whatsapp_1` ATUAL do cadastro (e nele
 * que se grava): numero final igual a ele = nada a gravar. Mas so conta como alteracao o que o expedidor
 * FEZ: enquanto ele nao escolheu outro telefone nem digitou (`tocado` falso), o numero mostrado e o da
 * regra unica — mesmo quando ele vem do Telefone fixo porque o WhatsApp 1 esta vazio — e nada e gravado.
 */
export function avaliarSelecaoDeTelefone(entrada: {
  whatsapp1: string;
  exibido: string;
  tocado: boolean;
  podeEditar: boolean;
}): AvaliacaoTelefone {
  return avaliarTelefoneEditado({
    original: entrada.tocado ? entrada.whatsapp1 : entrada.exibido,
    editado: entrada.exibido,
    podeEditar: entrada.podeEditar
  });
}

export type ResultadoGravarCadastro = { success: boolean; errorMessage?: string };

/**
 * Grava o telefone no cadastro do destinatario SE houver alteracao valida. `ok: false` = a gravacao
 * falhou e o despacho NAO pode seguir (a mensagem vai para a tela). Sem alteracao: nada e gravado.
 */
export async function gravarTelefoneDoDestinatario(
  avaliacao: AvaliacaoTelefone,
  idDestinatario: number | null,
  gravar: (idCliente: number, payload: { whatsapp_1: string }) => Promise<ResultadoGravarCadastro>
): Promise<{ ok: true; gravou: boolean; numero: string | null } | { ok: false; erro: string }> {
  if (!avaliacao.gravar) return { ok: true, gravou: false, numero: null };
  if (!idDestinatario || !Number.isInteger(idDestinatario) || idDestinatario <= 0) {
    return { ok: false, erro: "Não foi possível identificar o cadastro do destinatário para gravar o telefone." };
  }
  const r = await gravar(idDestinatario, { whatsapp_1: avaliacao.normalizado });
  if (!r.success) {
    return { ok: false, erro: r.errorMessage || "Não foi possível gravar o telefone no cadastro do destinatário." };
  }
  return { ok: true, gravou: true, numero: avaliacao.normalizado };
}
