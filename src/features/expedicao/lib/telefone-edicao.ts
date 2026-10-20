import { diagnosticarTelefone, normalizarTelefoneBR, soDigitos } from "@/lib/telefone/telefone-br";

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
