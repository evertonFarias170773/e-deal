import { normalizarCargoContato } from "@/features/cadastros/lib/cargo-contato";
import { contatoEstaAtivo } from "@/features/cadastros/lib/contatos-ativos";
import type { CadastroContato } from "@/features/cadastros/types";

/**
 * Comprador da arte (06/11/2026): regra única do "Enviar para arte".
 *
 * O pedido só vai para a arte com um contato Comprador do cliente (ativo, cargo
 * "Comprador") que tenha nome, fone (WhatsApp) e e-mail. Com mais de um
 * Comprador, o usuário escolhe e a escolha fica em `propostas.id_contato_comprador`;
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
  /** O escolhido: o gravado na proposta (se ainda é Comprador ativo) ou o único. */
  escolhido: T | null;
  /** Mais de um Comprador e nenhum escolhido. */
  precisaEscolher: boolean;
  faltas: FaltaDoComprador[];
  /** O "Enviar para arte" pode ser usado. */
  liberado: boolean;
  /** O que falta, para o aviso ao lado do botão. Nulo quando liberado. */
  aviso: string | null;
};

export function situacaoDoComprador<T extends ContatoDaArte>(
  contatos: readonly T[],
  idEscolhidoGravado: string | null | undefined
): SituacaoDoComprador<T> {
  const compradores = compradoresDoCliente(contatos);
  const gravado = String(idEscolhidoGravado ?? "").trim();
  const escolhido =
    compradores.find((c) => gravado !== "" && c.id === gravado) ??
    (compradores.length === 1 ? compradores[0] : null);

  if (compradores.length === 0) {
    return {
      compradores, escolhido: null, precisaEscolher: false, faltas: [], liberado: false,
      aviso: "O cliente não tem contato Comprador ativo. Adicione um Comprador para enviar para arte.",
    };
  }
  if (!escolhido) {
    return {
      compradores, escolhido: null, precisaEscolher: true, faltas: [], liberado: false,
      aviso: `O cliente tem ${compradores.length} Compradores. Escolha qual recebe a arte.`,
    };
  }
  const faltas = faltasDoComprador(escolhido);
  if (faltas.length > 0) {
    const nome = escolhido.nome.trim() || "escolhido";
    return {
      compradores, escolhido, precisaEscolher: false, faltas, liberado: false,
      aviso: `Falta ${listaDeFaltas(faltas)} no Comprador ${nome}. Complete o contato para enviar para arte.`,
    };
  }
  return { compradores, escolhido, precisaEscolher: false, faltas: [], liberado: true, aviso: null };
}
