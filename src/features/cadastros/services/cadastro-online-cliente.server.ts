import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReceitaCnpj } from "@/features/cadastros/services/receita-cnpj.server";

/**
 * Cria o cliente (e o endereco e o contato) a partir de um envio do cadastro
 * online. Uma copia so, para dois chamadores:
 *
 *   - a rota publica de envio, no CNPJ, que continua criando o cliente na hora
 *     (service_role);
 *   - a rota de aprovacao da fila, no CPF, que cria o cliente quando o
 *     atendente aprova (sessao do atendente).
 *
 * O corpo vivia inteiro em `/api/cadastro-online/enviar` e saiu de la em
 * 29/09/2026, sem mudanca de regra: as mesmas colunas, os mesmos defaults
 * respeitados, o mesmo cuidado com `id_cliente` (nunca 0) e a mesma tolerancia
 * a falha de endereco/contato depois de o cliente existir.
 */

export type DadosCadastroOnline = {
  tipoPessoa: "FISICA" | "JURIDICA";
  /** Só dígitos, já validados pelo dígito verificador. */
  documentoDigitos: string;
  nome: string;
  fantasia: string | null;
  email: string | null;
  whatsapp: string | null;
  telefoneFixo: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  idVendedor: string | null;
  nomeVendedor: string | null;
  /** Dados publicos da Receita, quando houve consulta (so CNPJ). */
  receita: ReceitaCnpj | null;
};

export type ResultadoCriacaoCliente =
  | { ok: true; idCliente: number }
  | { ok: false; erro: string };

const textoOuNulo = (valor: unknown): string | null => {
  const t = String(valor ?? "").trim();
  return t || null;
};

function montarCidadeUf(d: DadosCadastroOnline): string | null {
  const cidade = String(d.cidade ?? "").trim();
  const uf = String(d.uf ?? "").trim().toUpperCase();
  if (!cidade || !uf) return null;
  return `${cidade} - ${uf}`;
}

export async function criarClienteDoCadastroOnline(
  client: SupabaseClient,
  d: DadosCadastroOnline
): Promise<ResultadoCriacaoCliente> {
  const receita = d.receita;
  const emailInformado = textoOuNulo(d.email);
  const whatsappInformado = textoOuNulo(d.whatsapp);
  const telefoneInformado = textoOuNulo(d.telefoneFixo) || textoOuNulo(receita?.telefoneFixo);

  const insertCliente = {
    // `id_cliente` fica AUSENTE: e a ausencia que dispara o DEFAULT
    // `fn_proximo_id_cliente()`. Mandar null gravaria null em silencio.
    categoria: "CLIENTE",
    nome: receita?.razaoSocial || d.nome,
    fantasia: textoOuNulo(d.fantasia) || textoOuNulo(receita?.fantasia),
    documento: d.documentoDigitos,
    tipo_pessoa: d.tipoPessoa,
    id_vendedor: d.idVendedor ?? null,
    nome_vendedor: textoOuNulo(d.nomeVendedor),
    email: emailInformado,
    email_contato: emailInformado,
    whatsapp_1: whatsappInformado,
    telefone_fixo: telefoneInformado,
    cidade_uf: textoOuNulo(receita?.cidadeUf) || montarCidadeUf(d),
    ins_estadual: textoOuNulo(receita?.insEstadual),
    tipo_contribuinte: receita ? receita.tipoContribuinte : null,
    data_fundacao: receita?.dataFundacao ?? null,
    // `ativo` tem DEFAULT false na coluna. Sem esta linha o cadastro nasceria
    // INATIVO e sumiria da lista dos atendentes.
    ativo: true,
    restricao: false,
    recebe_email: Boolean(emailInformado),
    recebe_whatsapp: Boolean(whatsappInformado),
    // Veio de formulario publico: `verificado` fica false ate um atendente
    // olhar — inclusive no CPF aprovado pela fila, que e conferencia de
    // cadastro, nao de documento.
    verificado: false
    // `nota` (default true), `padrao_pagamento` e `limite_credito` ficam de fora
    // de proposito: os defaults da coluna sao a regra da casa, e o formulario
    // publico nao tem o que dizer sobre eles.
  };

  const { data: clienteCriado, error: erroCliente } = await client
    .from("clientes")
    .insert(insertCliente)
    .select("id_cliente,nome")
    .single();

  if (erroCliente || !clienteCriado) {
    console.error("[cadastro-online] insert em clientes falhou:", erroCliente?.message);
    return { ok: false, erro: erroCliente?.message ?? "insert em clientes sem retorno" };
  }

  // O numero e SEMPRE o que o banco devolveu. Cair para 0 penduraria endereco e
  // contato no id_cliente 0 — a mesma classe de erro que deixou 346 enderecos
  // orfaos na importacao de 2025. `enderecos` nao tem FK, nada barraria.
  const idCliente = Number(clienteCriado.id_cliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    console.error("[cadastro-online] insert em clientes nao devolveu id_cliente valido.");
    return { ok: false, erro: "insert em clientes nao devolveu id_cliente valido" };
  }

  const endereco = {
    id_cliente: idCliente,
    cep: textoOuNulo(d.cep),
    endereco: textoOuNulo(d.endereco),
    numero: textoOuNulo(d.numero),
    complemento: textoOuNulo(d.complemento),
    bairro: textoOuNulo(d.bairro),
    cidade: textoOuNulo(d.cidade),
    uf: String(d.uf ?? "").trim().toUpperCase().slice(0, 2) || null,
    tipo_endereco: "PRINCIPAL",
    obs: "Criado pelo cadastro online."
  };
  if (endereco.cep || endereco.endereco || endereco.cidade) {
    const { error: erroEndereco } = await client.from("enderecos").insert(endereco);
    if (erroEndereco) {
      // O cliente ja existe e o numero ja foi consumido. Derrubar tudo aqui
      // exigiria DELETE, e o desfazer desta feature e por INATIVACAO. Entao
      // registra e segue: a fila mostra o cadastro, e o atendente completa.
      console.error("[cadastro-online] endereco nao gravado:", erroEndereco.message);
    }
  }

  // Contato so quando ha o que contatar. Linha so com o nome seria ruido.
  if (emailInformado || whatsappInformado) {
    const { error: erroContato } = await client.from("contatos").insert({
      id_cliente: idCliente,
      nome_contato: d.nome,
      whats: whatsappInformado,
      e_mail: emailInformado
    });
    if (erroContato) {
      console.error("[cadastro-online] contato nao gravado:", erroContato.message);
    }
  }

  return { ok: true, idCliente };
}
