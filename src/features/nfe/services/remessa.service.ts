import { getSupabaseClient } from "@/lib/supabase/client";
import { idEnderecoEntregaVigente } from "@/features/expedicao/lib/endereco-entrega";
import { isValidCpf } from "@/features/cadastros/utils/documento";
import { escolherNotaAutorizadaDoPedido, COLUNAS_NOTA_DO_PEDIDO } from "@/lib/fiscal/nota-do-pedido";
import {
  cfopDaNatureza,
  getNaturezasOperacaoNfe,
  proximoSufixoRefNfe,
  tributacaoDaNatureza
} from "@/features/nfe/services/nfe.service";

/**
 * O rascunho da NOTA DE REMESSA — a segunda nota do pedido.
 *
 * POR QUE UM CAMINHO PROPRIO
 *   `createOrReuseNfeDraft` REAPROVEITA o rascunho PENDENTE do pedido e monta a
 *   nota a partir da proposta: destinatario = pagador, itens = produtos da
 *   proposta, natureza de venda, parcela pela cobranca. Para a remessa quase
 *   tudo muda de fonte — ela nasce da NOTA DE VENDA ja autorizada, vai para quem
 *   RECEBE e nao cobra nada. Encaixar isso la dentro significaria um segundo
 *   comportamento escondido na funcao que emite todas as notas de venda do ERP.
 *   Este arquivo nao toca naquele caminho.
 *
 * O QUE A REMESSA COPIA DA VENDA
 *   Itens (descricao, NCM, unidade, quantidade, valor unitario e total, peso),
 *   volumes, pesos e transportadora. Mercadoria e transporte sao os mesmos.
 *
 * O QUE ELA NAO COPIA
 *   - a TRIBUTACAO: CSOSN da venda e 102; a remessa usa o que o catalogo tem
 *     para 5949/6949 (400, com PIS e COFINS 99). Copiar o 102 tributaria de novo
 *     o que ja foi tributado na venda;
 *   - o DESTINATARIO: vem do endereco de entrega vigente, nao do pagador;
 *   - o FRETE e o DESCONTO: a remessa nao cobra nada (valores zerados);
 *   - a COBRANCA: sem duplicata.
 *
 * PAGAMENTO 90, COM UMA LINHA DE VALOR ZERO
 *   O layout 4.00 exige o grupo de pagamento, e `fn_montar_payload_nfe` monta
 *   `formas_pagamento` a partir de `notas_fiscais_pagamentos`. Sem nenhuma linha,
 *   o payload sairia com o grupo vazio e a SEFAZ recusaria. Entao a remessa nasce
 *   com UMA linha de forma 90 (Sem pagamento) e valor 0,00 — que e o que a NT
 *   exige para tPag 90. Ela nao e cobranca e nao vira duplicata: o payload so
 *   monta duplicata para forma 15.
 */

export type RemessaResultado =
  | { ok: true; id: string; ref: string; idEndereco: string; reaproveitado: boolean }
  | { ok: false; motivo: string };

type EnderecoDaRemessa = {
  id: string;
  recebedor: string | null;
  cpf_recebedor: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

const soDigitos = (valor: string | null | undefined) => String(valor ?? "").replace(/\D/g, "");

/** Status em que um rascunho de remessa ainda pode ser reaproveitado. */
const STATUS_REAPROVEITAVEL = ["PENDENTE", "RASCUNHO", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "ERRO_ENVIO"];

/**
 * O endereco que vale para a remessa, pela regra unica de
 * `idEnderecoEntregaVigente`: o do despacho confirmado, senao o da proposta.
 *
 * Devolve o motivo quando nao da para seguir — e o motivo vai inteiro para a
 * tela. NUNCA cai no endereco do pagador: uma remessa no nome de quem nao
 * recebe e pior do que remessa nenhuma.
 */
export async function enderecoDaRemessa(
  idInt: number
): Promise<{ ok: true; endereco: EnderecoDaRemessa } | { ok: false; motivo: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, motivo: "Sem conexão com o banco." };

  const [{ data: proposta }, { data: expedicao }] = await Promise.all([
    client.from("propostas").select("id_endereco_ent").eq("id_int", idInt).maybeSingle(),
    client.from("expedicoes").select("id_endereco_entrega, data_despacho").eq("id_int", idInt).maybeSingle()
  ]);

  const idEndereco = idEnderecoEntregaVigente({
    despachoConfirmado: Boolean((expedicao as { data_despacho?: string | null } | null)?.data_despacho),
    idGravadoNoDespacho: (expedicao as { id_endereco_entrega?: string | null } | null)?.id_endereco_entrega,
    idDefinidoNaProposta: (proposta as { id_endereco_ent?: string | null } | null)?.id_endereco_ent
  });

  if (!idEndereco) {
    return {
      ok: false,
      motivo: `O pedido #${idInt} não aponta endereço de entrega. Escolha o endereço no orçamento antes de gerar a remessa.`
    };
  }

  const { data: endereco } = await client
    .from("enderecos")
    .select("id, recebedor, cpf_recebedor, endereco, numero, complemento, bairro, cidade, uf, cep")
    .eq("id", idEndereco)
    .maybeSingle();

  if (!endereco) {
    return { ok: false, motivo: `O endereço de entrega do pedido #${idInt} não foi encontrado no cadastro.` };
  }

  const linha = endereco as EnderecoDaRemessa;
  const nome = String(linha.recebedor ?? "").trim();
  const cpf = soDigitos(linha.cpf_recebedor);

  if (!nome || cpf.length !== 11) {
    const faltando = [!nome ? "o nome do recebedor" : null, cpf.length !== 11 ? "o CPF do recebedor" : null]
      .filter(Boolean)
      .join(" e ");
    return {
      ok: false,
      motivo: `A nota de remessa sai no nome de quem recebe, e o endereço de entrega está sem ${faltando}. Complete no cadastro do cliente, no endereço de entrega, e tente de novo.`
    };
  }

  return { ok: true, endereco: linha };
}

/**
 * Cria (ou devolve, se ja existir em rascunho) a nota de REMESSA do pedido.
 *
 * A REF SEGUE O PADRAO DO PEDIDO: `NFE-{id_int}-{seq}`, com o seq saindo de
 * `proximoSufixoRefNfe` — a MESMA sequencia da venda. Um formato proprio
 * (`...-R01`) furaria o leitor de sufixo, que le o ultimo segmento como numero,
 * e faria a venda seguinte repetir um numero ja usado. Quem distingue remessa de
 * venda e `tipo_nota`, nao a ref.
 */
export async function criarRascunhoRemessa(idInt: number): Promise<RemessaResultado> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, motivo: "Sem conexão com o banco." };

  // 1. A remessa nasce da nota de VENDA autorizada. Sem ela, nao ha o que remeter.
  const { data: notasDoPedido } = await client
    .from("notas_fiscais")
    .select(`id, ref, id_int, id_cliente, id_empresa, id_endereco_destinatario, modalidade_frete, transportadora, id_transportadora_cliente, quantidade_volumes, especie_volumes, peso_liquido, peso_bruto, ${COLUNAS_NOTA_DO_PEDIDO}`)
    .eq("id_int", idInt);

  const notas = (notasDoPedido ?? []) as Array<Record<string, unknown>>;
  const venda = escolherNotaAutorizadaDoPedido(notas as never) as Record<string, unknown> | null;
  if (!venda) {
    return {
      ok: false,
      motivo: `O pedido #${idInt} não tem nota de venda autorizada. A remessa é emitida depois da venda.`
    };
  }

  // 2. Rascunho de remessa que ja exista e reaproveitado, como a venda faz.
  const jaExiste = notas.find(
    (nota) =>
      String(nota.tipo_nota ?? "").trim().toUpperCase() === "REMESSA" &&
      STATUS_REAPROVEITAVEL.includes(String(nota.status ?? "").toUpperCase())
  );
  if (jaExiste) {
    return {
      ok: true,
      id: String(jaExiste.id),
      ref: String(jaExiste.ref),
      idEndereco: String(jaExiste.id_endereco_destinatario ?? ""),
      reaproveitado: true
    };
  }

  // 3. Destinatario: endereco vigente, com recebedor e CPF. Bloqueia sem eles.
  const destino = await enderecoDaRemessa(idInt);
  if (!destino.ok) return { ok: false, motivo: destino.motivo };
  const endereco = destino.endereco;

  // 4. Natureza: 5949 dentro do estado, 6949 fora, com a tributacao do catalogo.
  const { data: empresaRow } = await client
    .from("empresas")
    .select("uf")
    .eq("id", Number(venda.id_empresa))
    .maybeSingle();
  const ufEmitente = String((empresaRow as { uf?: string | null } | null)?.uf ?? "").trim().toUpperCase();
  const ufDestino = String(endereco.uf ?? "").trim().toUpperCase();
  if (!ufEmitente || !ufDestino) {
    return { ok: false, motivo: "Não foi possível resolver a UF da empresa ou a do endereço de entrega." };
  }

  const catalogo = await getNaturezasOperacaoNfe();
  const interna = ufDestino === ufEmitente;
  const naturezaRemessa = catalogo.find((linha) => linha.cfop === (interna ? "5949" : "6949"));
  if (!naturezaRemessa) {
    return {
      ok: false,
      motivo: `O catálogo de naturezas não tem o CFOP ${interna ? "5949" : "6949"}, usado na remessa. Cadastre-o em Naturezas de Operação.`
    };
  }
  const cfopDosItens =
    cfopDaNatureza(naturezaRemessa.descricao, ufDestino, ufEmitente, catalogo) ?? naturezaRemessa.cfop;
  const tributacao = tributacaoDaNatureza(naturezaRemessa.descricao, catalogo);

  // 5. Itens da VENDA, na mesma quantidade e no mesmo valor.
  const { data: itensVenda } = await client
    .from("notas_fiscais_itens")
    .select("numero_item, codigo_produto, id_produto, id_produtos_proposta, descricao, ncm, unidade_comercial, unidade_tributavel, quantidade, valor_unitario, valor_bruto, quantidade_tributavel, valor_unitario_tributavel, icms_origem, peso_unitario_gramas, peso_total_gramas")
    .eq("ref", String(venda.ref))
    .eq("ativo", true)
    .order("numero_item", { ascending: true });

  const itens = (itensVenda ?? []) as Array<Record<string, unknown>>;
  if (itens.length === 0) {
    return { ok: false, motivo: `A nota de venda ${String(venda.ref)} não tem itens ativos para copiar.` };
  }

  const totalProdutos = Number(
    itens.reduce((soma, item) => soma + (Number(item.valor_bruto) || 0), 0).toFixed(2)
  );

  // 6. Cabecalho.
  const sufixo = await proximoSufixoRefNfe(idInt);
  const ref = `NFE-${idInt}-${String(sufixo).padStart(3, "0")}`;

  const nfeInsert = {
    id_int: idInt,
    // O cliente da nota segue sendo o do pedido: o payload SOBREPOE o
    // destinatario pelo endereco (migration 20260915225219), e o join com
    // `clientes` continua servindo para e-mail e para as telas do ERP.
    id_cliente: venda.id_cliente,
    id_empresa: venda.id_empresa,
    ref,
    // Como no caminho da venda: a emissao sincroniza o ambiente com a empresa.
    ambiente: "homologacao",
    modelo: "55",
    status: "PENDENTE",
    tipo_nota: "REMESSA",
    id_endereco_destinatario: endereco.id,
    natureza_operacao: naturezaRemessa.natureza,
    drop_natureza_op: naturezaRemessa.descricao,
    tipo_documento: 1,
    finalidade_emissao: 1,
    // Pessoa fisica sem inscricao: consumidor final e nao contribuinte.
    consumidor_final: 1,
    presenca_comprador: 2,
    tipo_contribuinte: 9,
    valor_produtos: totalProdutos,
    valor_desconto: 0,
    valor_frete: 0,
    valor_total_nf: totalProdutos,
    // Transporte e o mesmo da venda: e a mesma carga saindo.
    modalidade_frete: venda.modalidade_frete ?? 9,
    transportadora: venda.transportadora ?? null,
    id_transportadora_cliente: venda.id_transportadora_cliente ?? null,
    quantidade_volumes: venda.quantidade_volumes ?? 1,
    especie_volumes: venda.especie_volumes ?? "CAIXA",
    peso_liquido: venda.peso_liquido ?? 0,
    peso_bruto: venda.peso_bruto ?? 0,
    end_entrega: false,
    // Mesmo texto da venda: quem receber a nota sabe de que pedido ela veio.
    informacoes_complementares: `Pedido ${idInt}`,
    cond_pgto: false,
    forma_pgto: "SEM PAGAMENTO",
    pgto_is_configurado: true
  };

  const { data: novaNota, error: erroNota } = await client
    .from("notas_fiscais")
    .insert(nfeInsert)
    .select("id, ref")
    .single();

  if (erroNota || !novaNota) {
    return { ok: false, motivo: `Não foi possível criar a nota de remessa: ${erroNota?.message ?? "erro desconhecido"}.` };
  }

  // 7. Itens: os da venda, com o CFOP e a tributacao da REMESSA.
  const itensInsert = itens.map((item, idx) => ({
    id_nota_fiscal: novaNota.id,
    ref: novaNota.ref,
    id_int: idInt,
    id_produtos_proposta: item.id_produtos_proposta ?? null,
    id_produto: item.id_produto ?? null,
    numero_item: idx + 1,
    codigo_produto: item.codigo_produto,
    descricao: item.descricao,
    ncm: item.ncm,
    cfop: cfopDosItens,
    unidade_comercial: item.unidade_comercial ?? "UN",
    unidade_tributavel: item.unidade_tributavel ?? "UN",
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    valor_bruto: item.valor_bruto,
    quantidade_tributavel: item.quantidade_tributavel ?? item.quantidade,
    valor_unitario_tributavel: item.valor_unitario_tributavel ?? item.valor_unitario,
    icms_origem: item.icms_origem ?? 0,
    icms_situacao_tributaria: tributacao?.icms_situacao_tributaria ?? null,
    pis_situacao_tributaria: tributacao?.pis_situacao_tributaria ?? null,
    cofins_situacao_tributaria: tributacao?.cofins_situacao_tributaria ?? null,
    ativo: true,
    peso_unitario_gramas: item.peso_unitario_gramas ?? 0,
    peso_total_gramas: item.peso_total_gramas ?? 0
  }));

  const { error: erroItens } = await client.from("notas_fiscais_itens").insert(itensInsert);
  if (erroItens) {
    console.error("[RemessaService] Erro ao copiar itens da venda:", erroItens);
  }

  // 8. Totais pelo banco, como no caminho da venda.
  try {
    await client.rpc("fn_recalcular_totais_nfe", { p_ref: novaNota.ref });
  } catch (err) {
    console.warn("[RemessaService] fn_recalcular_totais_nfe falhou na remessa:", err);
  }

  // 9. Pagamento: forma 90 (Sem pagamento) e valor 0,00 — exigencia do layout,
  //    nao cobranca. Forma diferente de 15, entao nao vira duplicata.
  const { error: erroPagamento } = await client.from("notas_fiscais_pagamentos").insert({
    id_int: idInt,
    ref: novaNota.ref,
    id_nota_fiscal: novaNota.id,
    numero_parcela: 1,
    total_parcelas: 1,
    data_vencimento: new Date().toISOString().split("T")[0],
    valor: 0,
    forma_pagamento: "90",
    descricao_forma_pagamento: "Sem pagamento",
    ativo: true
  });
  if (erroPagamento) {
    console.error("[RemessaService] Erro ao gravar a forma de pagamento 90:", erroPagamento);
  }

  return { ok: true, id: String(novaNota.id), ref: String(novaNota.ref), idEndereco: endereco.id, reaproveitado: false };
}

/** O endereco gravado como destinatario da remessa, para a tela mostrar quem recebe. */
export type ResultadoRecebedor =
  | { ok: true; recebedor: string; cpfRecebedor: string }
  | { ok: false; motivo: string };

/**
 * Corrige NOME e CPF de quem recebe, no CADASTRO do endereço de entrega.
 *
 * ONDE O DADO MORA
 *   Em `enderecos.recebedor` e `enderecos.cpf_recebedor`, e continua morando lá
 *   — a nota não guarda cópia. Quem lê é `enderecoDaRemessa`, na criação da
 *   remessa, e `buscarEnderecoDestinatario`, na tela. Gravar aqui conserta o
 *   cadastro: a próxima remessa daquele endereço já nasce certa, e é por isso
 *   que a tela avisa, em texto, que a mudança não é só desta nota.
 *
 * POR QUE VALIDAR AQUI TAMBÉM
 *   A remessa é recusada sem nome ou sem CPF de 11 dígitos, e a recusa aparece
 *   tarde, na hora de emitir. Barrar na gravação é dizer a mesma coisa no
 *   momento em que dá para consertar. `isValidCpf` é A MESMA função do cadastro
 *   (`@/features/cadastros/utils/documento`) — CPF válido tem de significar a
 *   mesma coisa nas duas telas.
 *
 * O CPF É GRAVADO SÓ COM DÍGITOS. É o formato de 31 dos 51 endereços que têm
 * CPF hoje, e o que `soDigitos` espera dos dois lados. Máscara é coisa de
 * exibição.
 *
 * NÃO MEXE NO ENDEREÇO. Logradouro, número, bairro, cidade, UF e CEP são do
 * cadastro do cliente e continuam somente leitura na nota — corrigi-los aqui
 * mudaria para onde a mercadoria vai, que é outra decisão.
 */
export async function salvarRecebedorDoEndereco(args: {
  idEndereco: string;
  recebedor: string;
  cpfRecebedor: string;
}): Promise<ResultadoRecebedor> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, motivo: "Sem conexão com o banco." };

  const idEndereco = String(args.idEndereco ?? "").trim();
  if (!idEndereco) return { ok: false, motivo: "Esta nota não aponta um endereço de destinatário." };

  const nome = String(args.recebedor ?? "").trim().replace(/\s+/g, " ");
  if (!nome) {
    return { ok: false, motivo: "O nome de quem recebe é obrigatório: a remessa sai no nome dele." };
  }

  const cpf = soDigitos(args.cpfRecebedor);
  if (cpf.length !== 11 || !isValidCpf(cpf)) {
    return { ok: false, motivo: "CPF do recebedor inválido. Confira os 11 dígitos." };
  }

  const { data, error } = await client
    .from("enderecos")
    .update({ recebedor: nome, cpf_recebedor: cpf })
    .eq("id", idEndereco)
    .select("id");

  if (error) {
    console.error("[RemessaService] Erro ao salvar o recebedor do endereco:", error.message);
    return { ok: false, motivo: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, motivo: "O endereço não foi encontrado no cadastro." };
  }

  return { ok: true, recebedor: nome, cpfRecebedor: cpf };
}

export async function buscarEnderecoDestinatario(id: string | null | undefined): Promise<EnderecoDaRemessa | null> {
  const client = getSupabaseClient();
  const idEndereco = String(id ?? "").trim();
  if (!client || !idEndereco) return null;
  const { data } = await client
    .from("enderecos")
    .select("id, recebedor, cpf_recebedor, endereco, numero, complemento, bairro, cidade, uf, cep")
    .eq("id", idEndereco)
    .maybeSingle();
  return (data as EnderecoDaRemessa | null) ?? null;
}
