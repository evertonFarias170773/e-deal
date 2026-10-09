import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { escolherNotaAutorizadaDoPedido } from "@/lib/fiscal/nota-do-pedido";
import { chaveDoMunicipio, soDigitos } from "@/features/fiscal/lib/aviso-remessa";
import { idDestinatarioEtiquetaVigente, nomeDestinatarioVigente } from "../lib/destinatario-etiqueta";
import { idEnderecoEntregaVigente } from "../lib/endereco-entrega";
import { telefoneDestinatario } from "../lib/telefone-destinatario";
import { pesoInicialPorVolume } from "../lib/azul-awb";

/**
 * Tudo que a emissao da AWB da Azul precisa saber do pedido, lido do banco.
 *
 * Fontes (mapeadas em 09/10/2026):
 *   - NF-e: `notas_fiscais` — `escolherNotaAutorizadaDoPedido` (AUTORIZADA, de
 *     producao, nunca a remessa). Chave: `chave_nfe`. Valor: `valor_total_nf`.
 *     DataEmissao: a data de emissao ENVIADA a Focus (`payload_envio.data_emissao`);
 *     so se ela faltar cai em `data_autorizacao`, e o contexto diz qual usou.
 *   - Emitente e tomador (CIF): a empresa que emitiu a NF-e (`notas_fiscais.id_empresa`
 *     -> `empresas`). Codigo IBGE: `codigo_municipio_nfse` ou `ibge_municipios`.
 *   - Destinatario: mesma resolucao da prepostagem dos Correios (endereco e
 *     cadastro vigentes). IE: `clientes.ins_estadual`, depois `enderecos.ie_recebedor`.
 *     IBGE: `ibge_municipios` por cidade + UF.
 *
 * NADA aqui escreve. Dimensoes e peso por volume NAO existem no banco: vem do
 * operador, no modal.
 */

export type ParticipanteAzul = {
  Tipo: string;
  CnpjCpf: string;
  Nome: string;
  Estado: string;
  IENumero: string;
  Contato: { Nome: string; Email: string; Telefone: string };
  Endereco: {
    Logradouro: string;
    Numero: string;
    Complemento: string;
    Bairro: string;
    Cidade: string;
    CEP: string;
    MunicipioCodigoIbge: string;
  };
};

export type ContextoAzul = {
  idInt: number;
  modalidade: string | null;
  azulAwb: string | null;
  azulStatus: string | null;
  nota: {
    chave: string;
    valorTotal: number;
    dataEmissao: string;
    /** De onde saiu a data: o dado de emissao enviado a Focus ou, na falta, a autorizacao. */
    origemData: "emissao" | "autorizacao";
  };
  emitente: ParticipanteAzul;
  destinatario: ParticipanteAzul;
  cepDestino: string;
  qtdVolumes: number;
  pesoPorVolumeKg: number | null;
};

export type FalhaContexto = { ok: false; status: number; message: string; code?: string };
export type ResultadoContexto = { ok: true; ctx: ContextoAzul } | FalhaContexto;

const falha = (status: number, message: string, code?: string): FalhaContexto => ({ ok: false, status, message, code });

type EmpresaLinha = {
  id: number;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  inscricao_estadual: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  codigo_municipio_nfse: string | null;
  telefone_nfe: string | null;
  telefone_nfse: string | null;
  email_nfe: string | null;
};

async function codigoIbge(
  supabase: SupabaseClient,
  cidade: string | null | undefined,
  uf: string | null | undefined
): Promise<string | null> {
  const chave = chaveDoMunicipio(cidade);
  const sigla = String(uf ?? "").trim().toUpperCase();
  if (!chave || sigla.length !== 2) return null;
  const { data } = await supabase.from("ibge_municipios").select("codigo_ibge").eq("uf", sigla).eq("nome_chave", chave).maybeSingle();
  return data?.codigo_ibge ? String(data.codigo_ibge) : null;
}

function dataIso(valor: unknown): string | null {
  const ms = Date.parse(String(valor ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function carregarContextoAzul(supabase: SupabaseClient, idInt: number): Promise<ResultadoContexto> {
  const [{ data: proposta }, { data: exp }, { data: notas }] = await Promise.all([
    supabase.from("propostas").select("id_int, id_cliente, id_faturado, id_endereco_ent").eq("id_int", idInt).maybeSingle(),
    supabase
      .from("expedicoes")
      .select(
        "modalidade_frete, peso_kg, qtd_volumes, id_endereco_entrega, id_cliente_destinatario_etiqueta, data_despacho, azul_awb, azul_status"
      )
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("notas_fiscais")
      .select(
        "status, numero_nf, ambiente, tipo_nota, data_autorizacao, created_at, chave_nfe, valor_total_nf, id_empresa, payload_envio"
      )
      .eq("id_int", idInt)
  ]);

  if (!proposta) return falha(404, "Pedido não encontrado.");
  if (!exp) return falha(409, "Salve os dados de expedição do pedido antes de emitir a AWB.", "SEM_EXPEDICAO");

  if (exp.azul_awb) return falha(409, `Este pedido já tem AWB Azul (${exp.azul_awb}).`, "JA_EMITIDA");
  if (exp.azul_status === "EMITINDO") return falha(409, "Já existe uma emissão em andamento para este pedido.", "EM_ANDAMENTO");
  if (exp.azul_status === "INCERTA") {
    return falha(409, "A última emissão ficou incerta (a Azul não respondeu). Confira no portal da Azul antes de qualquer nova tentativa.", "INCERTA");
  }
  if (exp.modalidade_frete !== "CIF") {
    return falha(422, "A AWB da Azul só é emitida em frete CIF. Em FOB o cliente contrata a Azul.", "NAO_CIF");
  }

  const nota = escolherNotaAutorizadaDoPedido(notas ?? []);
  const chave = soDigitos(nota?.chave_nfe);
  if (!nota || chave.length !== 44) {
    return falha(422, "A AWB exige NF-e autorizada (com chave de acesso) neste pedido.", "SEM_NFE");
  }
  const valorTotal = Number(nota.valor_total_nf);
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) return falha(422, "A NF-e do pedido está sem valor total.", "SEM_VALOR");

  const envio = (nota.payload_envio ?? null) as { data_emissao?: unknown } | null;
  const emissao = dataIso(envio?.data_emissao);
  const autorizacao = dataIso(nota.data_autorizacao);
  const dataEmissao = emissao ?? autorizacao;
  if (!dataEmissao) return falha(422, "Não foi possível determinar a data de emissão da NF-e.", "SEM_DATA");

  // Emitente = tomador: a empresa que emitiu a NF-e.
  const { data: empresaLinha } = await supabase
    .from("empresas")
    .select(
      "id, razao_social, nome_fantasia, cnpj, inscricao_estadual, cep, logradouro, numero, complemento, bairro, municipio, uf, codigo_municipio_nfse, telefone_nfe, telefone_nfse, email_nfe"
    )
    .eq("id", nota.id_empresa)
    .maybeSingle();
  const empresa = empresaLinha as EmpresaLinha | null;
  if (!empresa) return falha(422, "Não achei a empresa que emitiu a NF-e.", "SEM_EMPRESA");

  const faltaEmpresa: string[] = [];
  if (soDigitos(empresa.cnpj).length !== 14) faltaEmpresa.push("CNPJ");
  if (!String(empresa.inscricao_estadual ?? "").trim()) faltaEmpresa.push("inscrição estadual");
  if (soDigitos(empresa.cep).length !== 8) faltaEmpresa.push("CEP");
  for (const [nome, v] of [
    ["logradouro", empresa.logradouro],
    ["número", empresa.numero],
    ["bairro", empresa.bairro],
    ["município", empresa.municipio],
    ["UF", empresa.uf],
    ["e-mail", empresa.email_nfe]
  ] as const) {
    if (!String(v ?? "").trim()) faltaEmpresa.push(nome);
  }
  const telefoneEmpresa = telefoneDestinatario(empresa.telefone_nfe, empresa.telefone_nfse);
  if (!telefoneEmpresa) faltaEmpresa.push("telefone");
  const ibgeEmpresa = String(empresa.codigo_municipio_nfse ?? "").trim() || (await codigoIbge(supabase, empresa.municipio, empresa.uf));
  if (!ibgeEmpresa) faltaEmpresa.push("código IBGE do município");
  const nomeEmpresa = String(empresa.razao_social ?? empresa.nome_fantasia ?? "").trim();
  if (!nomeEmpresa) faltaEmpresa.push("razão social");
  if (faltaEmpresa.length > 0) {
    return falha(422, `Cadastro da empresa emitente incompleto (${faltaEmpresa.join(", ")}). Complete em Empresas antes de emitir.`, "EMITENTE_INCOMPLETO");
  }

  const emitente: ParticipanteAzul = {
    Tipo: "Emitente",
    CnpjCpf: soDigitos(empresa.cnpj),
    Nome: nomeEmpresa,
    Estado: String(empresa.uf).trim().toUpperCase(),
    IENumero: String(empresa.inscricao_estadual).trim(),
    Contato: { Nome: String(empresa.nome_fantasia ?? nomeEmpresa).trim(), Email: String(empresa.email_nfe).trim(), Telefone: telefoneEmpresa },
    Endereco: {
      Logradouro: String(empresa.logradouro).trim(),
      Numero: String(empresa.numero).trim(),
      Complemento: String(empresa.complemento ?? "").trim(),
      Bairro: String(empresa.bairro).trim(),
      Cidade: String(empresa.municipio).trim(),
      CEP: soDigitos(empresa.cep),
      MunicipioCodigoIbge: ibgeEmpresa ?? ""
    }
  };

  // Destinatario: mesma resolucao da prepostagem dos Correios.
  const idCliente = proposta.id_cliente !== null && proposta.id_cliente !== undefined ? Number(proposta.id_cliente) : null;
  const idFaturado = proposta.id_faturado !== null && proposta.id_faturado !== undefined ? Number(proposta.id_faturado) : null;
  const idEndereco = idEnderecoEntregaVigente({
    despachoConfirmado: Boolean(exp.data_despacho),
    idGravadoNoDespacho: exp.id_endereco_entrega as string | null | undefined,
    idDefinidoNaProposta: proposta.id_endereco_ent as string | null | undefined
  });
  if (!idEndereco) {
    return falha(422, "Pedido sem endereço de entrega definido — escolha o endereço em Editar dados de expedição.", "SEM_ENDERECO");
  }
  const { data: end } = await supabase
    .from("enderecos")
    .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor, ie_recebedor")
    .eq("id", idEndereco)
    .maybeSingle();
  const faltaEnd: string[] = [];
  if (!end) faltaEnd.push("endereço");
  else {
    if (soDigitos(end.cep).length !== 8) faltaEnd.push("CEP");
    for (const [nome, v] of [
      ["logradouro", end.endereco],
      ["número", end.numero],
      ["bairro", end.bairro],
      ["cidade", end.cidade],
      ["UF", end.uf]
    ] as const) {
      if (!String(v ?? "").trim()) faltaEnd.push(nome);
    }
  }
  const ibgeDest = end ? await codigoIbge(supabase, end.cidade, end.uf) : null;
  if (end && !ibgeDest) faltaEnd.push("código IBGE do município");
  if (!end || faltaEnd.length > 0) {
    return falha(422, `Endereço de entrega incompleto (${faltaEnd.join(", ")}). Corrija o endereço do cliente antes de emitir.`, "DESTINO_INCOMPLETO");
  }

  const idDest = idDestinatarioEtiquetaVigente({
    despachoConfirmado: Boolean(exp.data_despacho),
    idClienteProposta: idCliente,
    idFaturado,
    idGravadoNoDespacho: exp.id_cliente_destinatario_etiqueta as number | null | undefined
  });
  const { data: cliente } =
    idDest !== null
      ? await supabase
          .from("clientes")
          .select("nome, fantasia, documento, ins_estadual, contato, email, email_contato, whatsapp_1, telefone_fixo")
          .eq("id_cliente", idDest)
          .maybeSingle()
      : { data: null };
  if (!cliente) return falha(422, "Não achei o cadastro do destinatário.", "SEM_DESTINATARIO");
  const documento = soDigitos(cliente.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    return falha(422, "O destinatário está sem CPF/CNPJ válido no cadastro.", "DESTINATARIO_SEM_DOCUMENTO");
  }
  const nomeDest = nomeDestinatarioVigente({
    idGravadoNoDespacho: exp.id_cliente_destinatario_etiqueta as number | null | undefined,
    idDestinatarioResolvido: idDest,
    recebedorDoEndereco: end.recebedor,
    nomeDoCadastro: String(cliente.nome ?? cliente.fantasia ?? "").trim()
  });

  const destinatario: ParticipanteAzul = {
    Tipo: "Destinatario",
    CnpjCpf: documento,
    Nome: nomeDest,
    Estado: String(end.uf).trim().toUpperCase(),
    // Vazio quando o cadastro nao tem: o modal pede, ou o operador marca ISENTO.
    IENumero: String(cliente.ins_estadual ?? "").trim() || String(end.ie_recebedor ?? "").trim(),
    Contato: {
      Nome: String(cliente.contato ?? "").trim() || nomeDest,
      Email: String(cliente.email_contato ?? "").trim() || String(cliente.email ?? "").trim(),
      Telefone: telefoneDestinatario(cliente.whatsapp_1, cliente.telefone_fixo)
    },
    Endereco: {
      Logradouro: String(end.endereco).trim(),
      Numero: String(end.numero).trim(),
      Complemento: String(end.complemento ?? "").trim(),
      Bairro: String(end.bairro).trim(),
      Cidade: String(end.cidade).trim(),
      CEP: soDigitos(end.cep),
      MunicipioCodigoIbge: ibgeDest as string
    }
  };

  const pesoKg = Number(exp.peso_kg) > 0 ? Number(exp.peso_kg) : null;
  const qtdVolumes = Number(exp.qtd_volumes) > 0 ? Number(exp.qtd_volumes) : 1;

  return {
    ok: true,
    ctx: {
      idInt,
      modalidade: exp.modalidade_frete,
      azulAwb: null,
      azulStatus: exp.azul_status ?? null,
      nota: { chave, valorTotal, dataEmissao, origemData: emissao ? "emissao" : "autorizacao" },
      emitente,
      destinatario,
      cepDestino: destinatario.Endereco.CEP,
      qtdVolumes,
      pesoPorVolumeKg: pesoInicialPorVolume(pesoKg, qtdVolumes)
    }
  };
}
