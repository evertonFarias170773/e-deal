/**
 * Contato NOVO criado na proposta entra no cadastro do cliente (03/11/2026).
 *
 * Antes, o contato adicionado na aba Geral só gravava o nome em
 * `propostas.contato`; WhatsApp e e-mail se perdiam e o id ficava
 * `cont_prop_<timestamp>` (pedido 24648). Agora, no "Salvar alterações", cada
 * contato novo é gravado em `contatos` pelo fluxo oficial da tela de Clientes
 * (`createCadastroContatos`) e a proposta passa a apontar para o id real.
 *
 * Idempotente: antes de criar, relê os contatos do cliente no banco. Se já
 * houver um com o mesmo nome, WhatsApp ou e-mail, usa esse e não cria outro —
 * nem altera o que existe. Contato que já é do cadastro nunca passa por aqui.
 */

export type ContatoDoCadastroLido = {
  id: string | number;
  nome_contato: string | null;
  cargo?: string | null;
  whats: string | null;
  e_mail: string | null;
};

export type ContatoNovoDaTela = {
  nome: string;
  cargo: string;
  whatsapp: string;
  email: string;
};

export type DependenciasContatoNovo = {
  /** Contatos do cliente lidos do banco na hora do salvar. */
  listar: (idCliente: number) => Promise<{ ok: true; contatos: ContatoDoCadastroLido[] } | { ok: false; motivo: string }>;
  /** O fluxo oficial de criação (createCadastroContatos), devolvendo o id criado. */
  criar: (idCliente: number, contato: ContatoNovoDaTela) => Promise<{ ok: true; id: string } | { ok: false; motivo: string }>;
};

export type ResultadoContatoNovo =
  | { ok: true; id: string; criado: boolean; existente: ContatoDoCadastroLido | null }
  | { ok: false; motivo: string };

function nomeComparavel(valor: string | null | undefined) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Só dígitos, sem o 55 do país: "5551 98911-5" e "51 98911-5" são o mesmo. */
function telefoneComparavel(valor: string | null | undefined) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
}

function emailComparavel(valor: string | null | undefined) {
  return String(valor ?? "").trim().toLowerCase();
}

/** O contato do cadastro igual ao novo (mesmo nome, WhatsApp ou e-mail), ou null. */
export function acharContatoIgual(
  existentes: readonly ContatoDoCadastroLido[],
  novo: ContatoNovoDaTela
): ContatoDoCadastroLido | null {
  const nome = nomeComparavel(novo.nome);
  const telefone = telefoneComparavel(novo.whatsapp);
  const email = emailComparavel(novo.email);

  return (
    existentes.find((c) => {
      if (nome && nomeComparavel(c.nome_contato) === nome) return true;
      if (telefone && telefoneComparavel(c.whats) === telefone) return true;
      if (email && emailComparavel(c.e_mail) === email) return true;
      return false;
    }) ?? null
  );
}

export async function gravarContatoNovoNoCadastro(
  idCliente: number,
  novo: ContatoNovoDaTela,
  deps: DependenciasContatoNovo
): Promise<ResultadoContatoNovo> {
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return { ok: false, motivo: "Cliente da proposta sem cadastro: o contato não pode ir para o cadastro." };
  }

  const lidos = await deps.listar(idCliente);
  if (!lidos.ok) return { ok: false, motivo: lidos.motivo };

  const igual = acharContatoIgual(lidos.contatos, novo);
  if (igual) return { ok: true, id: String(igual.id), criado: false, existente: igual };

  const criado = await deps.criar(idCliente, novo);
  if (!criado.ok) return { ok: false, motivo: criado.motivo };
  return { ok: true, id: criado.id, criado: true, existente: null };
}
