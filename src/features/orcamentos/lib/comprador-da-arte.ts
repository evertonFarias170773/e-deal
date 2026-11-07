import { normalizarCargoContato } from "@/features/cadastros/lib/cargo-contato";
import { contatoEstaAtivo } from "@/features/cadastros/lib/contatos-ativos";
import type { CadastroContato } from "@/features/cadastros/types";

/**
 * Comprador da arte (06/11/2026): regra única do "Enviar para arte".
 *
 * O pedido só vai para a arte com um contato Comprador do cliente (ativo, cargo
 * "Comprador") que tenha nome, fone (WhatsApp) e e-mail. Com mais de um
 * Comprador, o usuário escolhe e a escolha fica em `propostas.id_contato` (o mesmo "Contato responsável" da aba Geral);
 * com um só, ele já vem escolhido. Pedido que já foi enviado para a arte não é
 * travado: a regra vale para o primeiro envio.
 */

type ContatoDaArte = Pick<CadastroContato, "id" | "nome" | "cargo" | "whatsapp" | "email" | "ativo">;

export type FaltaDoComprador = "nome" | "fone" | "e-mail";

/** Fone com DDD: 10 ou mais dígitos. */
export function foneDoCompradorValido(valor: string | null | undefined): boolean {
  return String(valor ?? "").replace(/\D/g, "").length >= 10;
}

export function emailDoCompradorValido(valor: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor ?? "").trim());
}

export function faltasDoComprador(contato: Pick<ContatoDaArte, "nome" | "whatsapp" | "email">): FaltaDoComprador[] {
  const faltas: FaltaDoComprador[] = [];
  if (!String(contato.nome ?? "").trim()) faltas.push("nome");
  if (!foneDoCompradorValido(contato.whatsapp)) faltas.push("fone");
  if (!emailDoCompradorValido(contato.email)) faltas.push("e-mail");
  return faltas;
}

export function ehCompradorAtivo(contato: Pick<ContatoDaArte, "cargo" | "ativo">): boolean {
  return contatoEstaAtivo(contato) && normalizarCargoContato(contato.cargo) === "Comprador";
}

export function compradoresDoCliente<T extends ContatoDaArte>(contatos: readonly T[]): T[] {
  return contatos.filter(ehCompradorAtivo);
}

/** "Usar contato existente como Comprador": os ativos do cliente que ainda não são Comprador. */
export function contatosParaVirarComprador<T extends ContatoDaArte>(contatos: readonly T[]): T[] {
  return contatos.filter((c) => contatoEstaAtivo(c) && !ehCompradorAtivo(c));
}

/**
 * Arte ainda não enviada: sem linha em `pedidos_artes` ou com status vazio,
 * AGUARDANDO (rascunho salvo sem designer) ou PENDENTE. Qualquer outro status
 * (EM ARTE, Em Aprovação, APROVADO...) é pedido já enviado e fica como está.
 */
export function arteJaEnviada(statusArte: string | null | undefined): boolean {
  const s = String(statusArte ?? "").trim().toUpperCase();
  return s !== "" && s !== "AGUARDANDO" && s !== "PENDENTE";
}

function listaDeFaltas(faltas: FaltaDoComprador[]): string {
  if (faltas.length <= 1) return faltas.join("");
  return `${faltas.slice(0, -1).join(", ")} e ${faltas[faltas.length - 1]}`;
}

export type SituacaoDoComprador<T extends ContatoDaArte> = {
  compradores: T[];
  /** O escolhido: o contato responsável da proposta (se é Comprador ativo) ou o único Comprador. */
  escolhido: T | null;
  /** O contato responsável da proposta quando ele NÃO é Comprador ativo (aviso + "Usar como Comprador"). */
  responsavelNaoComprador: T | null;
  /** Mais de um Comprador e nenhum escolhido. */
  precisaEscolher: boolean;
  faltas: FaltaDoComprador[];
  /** O "Enviar para arte" pode ser usado. */
  liberado: boolean;
  /** O que falta, para o aviso ao lado do botão. Nulo quando liberado. */
  aviso: string | null;
};

/**
 * Desde 07/11/2026 o Comprador da arte É o "Contato responsável" da aba Geral:
 * um campo só, `propostas.id_contato` (`idContatoDaProposta` = `form.contatoId`).
 * Responsável que não é Comprador não é trocado sozinho: a tela avisa e oferece
 * "Usar como Comprador" ou escolher outro Comprador.
 */
export function situacaoDoComprador<T extends ContatoDaArte>(
  contatos: readonly T[],
  idContatoDaProposta: string | null | undefined
): SituacaoDoComprador<T> {
  const compradores = compradoresDoCliente(contatos);
  const idResp = String(idContatoDaProposta ?? "").trim();
  const responsavel = idResp !== "" ? contatos.find((c) => c.id === idResp) ?? null : null;

  if (responsavel && !ehCompradorAtivo(responsavel)) {
    const nome = responsavel.nome.trim() || "escolhido";
    return {
      compradores, escolhido: null, responsavelNaoComprador: responsavel, precisaEscolher: false, faltas: [], liberado: false,
      aviso: `O contato responsável (${nome}) não é Comprador. Use-o como Comprador ou escolha outro Comprador.`,
    };
  }

  const escolhido = responsavel ?? (compradores.length === 1 ? compradores[0] : null);

  if (compradores.length === 0) {
    return {
      compradores, escolhido: null, responsavelNaoComprador: null, precisaEscolher: false, faltas: [], liberado: false,
      aviso: "O cliente não tem contato Comprador ativo. Adicione um Comprador para enviar para arte.",
    };
  }
  if (!escolhido) {
    return {
      compradores, escolhido: null, responsavelNaoComprador: null, precisaEscolher: true, faltas: [], liberado: false,
      aviso: `O cliente tem ${compradores.length} Compradores. Escolha qual recebe a arte (vira o contato responsável da proposta).`,
    };
  }
  const faltas = faltasDoComprador(escolhido);
  if (faltas.length > 0) {
    const nome = escolhido.nome.trim() || "escolhido";
    return {
      compradores, escolhido, responsavelNaoComprador: null, precisaEscolher: false, faltas, liberado: false,
      aviso: `Falta ${listaDeFaltas(faltas)} no Comprador ${nome}. Complete o contato para enviar para arte.`,
    };
  }
  return { compradores, escolhido, responsavelNaoComprador: null, precisaEscolher: false, faltas: [], liberado: true, aviso: null };
}
