import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverPesoExpedicao } from "../lib/peso";
import { idDestinatarioEtiquetaVigente } from "../lib/destinatario-etiqueta";
import { idEnderecoEntregaVigente } from "../lib/endereco-entrega";
import { telefoneDestinatario } from "../lib/telefone-destinatario";
import { nomeTransporteEfetivo } from "@/features/orcamentos/lib/modalidade-frete";
import type { ModalidadeFrete } from "../types";
import { escolherNotaAutorizadaDoPedido } from "@/lib/fiscal/nota-do-pedido";
import { resolverEmpresaRemetente } from "@/lib/correios/empresa-remetente";

export type EtiquetaViewModel = {
  idInt: number;
  volumes: number;
  pesoKg: string;
  transportadora: string;
  codigoRastreamento: string;
  obs: string;
  /** Número da NF-e autorizada; vazio quando a remessa vai sem nota. */
  nfNumero: string;
  /** Embalagem declarada no despacho (Pacote, Caixa, Envelope…). */
  tipoVolume: string;
  /** Remetente em uma linha — mantido para compatibilidade de leitura. */
  remetenteRodape: string;
  /**
   * REMETENTE COMPLETO, do cadastro em `empresas` (02/09/2026).
   *
   * O layout novo imprime o bloco inteiro; antes so o nome saia, e vinha de
   * `propostas.empresa` como texto. `resolverEmpresaRemetente` e a MESMA funcao
   * que a Declaracao de Conteudo e a prepostagem ja usam.
   */
  remetente: {
    /** `nome_fantasia` do cadastro — ou "DSEG BRASIL" na regra do 8469. */
    nome: string;
    /** "RUA FELIZARDO DE FARIAS, 81" */
    logradouro: string;
    /** "BAIRRO MEDIANEIRA, PORTO ALEGRE/RS" */
    bairroCidadeUf: string;
  };
  /**
   * `expedicoes.obs_etiqueta` — o texto IMPRESSO no volume.
   *
   * NAO e `obs` acima, que e a observacao logistica INTERNA e continua sem sair
   * em documento nenhum. Ver o cabecalho da migration
   * `20260902183633_expedicoes_obs_etiqueta.sql`.
   */
  obsEtiqueta: string;
  /** Data de envio ja formatada em dd/mm/aaaa. */
  dataEnvio: string;
  destinatario: {
    nome: string;
    recebedor: string;
    endereco: string;
    bairro: string;
    cidadeUf: string;
    cep: string;
    documento: string;
    /**
     * O telefone que VAI IMPRESSO, resolvido do CADASTRO pela regra de
     * `lib/telefone-destinatario.ts`: o primeiro campo que É telefone, nunca o
     * primeiro preenchido.
     */
    telefone: string;
  };
};

function fmtPeso(pesoKg: number | null): string {
  if (pesoKg === null || !Number.isFinite(pesoKg) || pesoKg <= 0) return "";
  return pesoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDocumento(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return String(bruto ?? "").trim();
}

function fmtCep(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, "$1-$2") : String(bruto ?? "").trim();
}

/**
 * Cliente cujos volumes saem com outro nome de remetente na etiqueta 10x15.
 * 8469 = LISITON DOCUMENTOS SEGUROS LTDA.
 */
const CLIENTE_REMETENTE_ALTERNATIVO = 8469;
const NOME_REMETENTE_ALTERNATIVO = "DSEG BRASIL";

/**
 * Nome que aparece no RODAPE da etiqueta 10x15 (24/08/2026).
 *
 * E EXIBICAO, E SO AQUI
 *   Nada de cadastro, proposta, expedicao ou nota fiscal muda por causa disto,
 *   e o remetente REAL da operacao continua sendo a empresa emitente. A etiqueta
 *   oficial dos Correios e a Declaracao de Conteudo montam o remetente por
 *   caminho proprio (`lib/correios/empresa-remetente`), casado com as
 *   credenciais de quem posta — nenhuma das duas passa por aqui, e nenhuma
 *   delas muda.
 *
 * A CONDICAO E O CLIENTE DA PROPOSTA, NAO O PAGADOR
 *   `idCliente` vem de `propostas.id_cliente`. `propostas.id_faturado` — o
 *   pagador, usado quando quem paga difere de quem compra — NAO entra nesta
 *   conta e sequer e lido por esta funcao. Cliente 8469 com pagador outro: a
 *   regra VALE. Pagador 8469 com cliente outro: a regra NAO vale. O pedido
 *   20872 e exatamente o primeiro caso (cliente 8469, pagador 980).
 *
 * Cidade e UF seguem sendo os da empresa emitente: so o nome troca.
 */
function nomeRemetenteExibido(idCliente: number | null, nomeEmpresa: string): string {
  return idCliente === CLIENTE_REMETENTE_ALTERNATIVO ? NOME_REMETENTE_ALTERNATIVO : nomeEmpresa;
}

export async function montarEtiquetaViewModel(
  supabase: SupabaseClient,
  idInt: number
): Promise<EtiquetaViewModel | null> {
  const { data: proposta } = await supabase
    .from("propostas")
    // `id_endereco_ent`, `modalidade_frete` e `id_transportadora_cliente`
    // (02/09/2026): o endereço definido na proposta e o que decide o transporte
    // real sob FOB. Mesma linha que já vinha — nenhuma consulta a mais.
    .select(
      "id_int, cliente, id_cliente, id_faturado, empresa, cep, id_endereco_ent, modalidade_frete, id_transportadora_cliente"
    )
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const [{ data: exp }, { data: os }, { data: frete }, { data: notas }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select(
        "peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, transportadora_nome, id_transportadora_cliente, codigo_rastreamento, id_endereco_entrega, id_cliente_destinatario_etiqueta, obs, obs_etiqueta, nf_numero_manual, data_despacho"
      )
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase.from("propostas_os").select("codigo_rastreamento").eq("id_int", idInt).maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("servico, peso, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle(),
    // `data_autorizacao` e `created_at` entram no MESMO select que já existia —
    // nenhuma consulta a mais, nenhum round-trip a mais. Servem ao desempate
    // logo abaixo.
    supabase
      .from("notas_fiscais")
      .select("numero_nf, status, data_autorizacao, created_at")
      .eq("id_int", idInt)
  ]);

  /**
   * A nota que vai para a etiqueta. Critério em `@/lib/fiscal/nota-do-pedido`,
   * compartilhado com a lista da Expedição e com o lançamento de boletos — os
   * três precisam concordar sobre qual é "a nota do pedido".
   *
   * Rascunho e nota cancelada nunca entram: impressas no volume, induziriam a
   * conferência a erro.
   */
  const nfAutorizada = escolherNotaAutorizadaDoPedido(notas) ?? undefined;

  // Endereço: o escolhido no despacho > o que casa com o CEP cotado > o mais recente.
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  let endereco: {
    endereco: string | null; numero: string | null; complemento: string | null;
    bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
    recebedor: string | null;
  } | null = null;

  /**
   * Rascunho NAO entra na etiqueta. `expedicoes` passou a poder guardar dados
   * de despacho ainda NAO confirmado ("Salvar sem despachar", 20/08/2026), e
   * etiqueta impressa vira caixa despachada: destino, transportadora, volumes e
   * rastreio saem daqui so quando `data_despacho` existe.
   *
   * DUAS EXCECOES, e as duas sao dado legitimo de ANTES do despacho:
   *   - PESO, que segue a precedencia unica de `lib/peso.ts` — e o peso real
   *     medido na balanca;
   *   - VOLUMES e TIPO DE VOLUME, gravados pela Revisao do boletim
   *     (`revisao-expedicao.service.ts`, secao 3.4) muito antes de existir
   *     despacho. Gatea-los apagaria da etiqueta o que a Revisao registrou.
   */
  const expConfirmado = exp?.data_despacho ? exp : null;

  /**
   * O NOME DA TRANSPORTADORA SAI DO CADASTRO VINCULADO (27/08/2026).
   *
   * `transportadora_nome` era a única fonte, e não é confiável: até esta data o
   * modal Despachar tinha um campo rotulado "Serviço" escrevendo nessa mesma
   * coluna, então o serviço apagava o nome da transportadora. O pedido 21245
   * tem `id_transportadora_cliente = 808` (SVT TRANSPORTES) com
   * `transportadora_nome = 'ECOMM'` — e a etiqueta imprimia ECOMM.
   *
   * Havendo vínculo, o cadastro manda: ele é a escolha estruturada, e o texto
   * livre é o que se degradou. Sem vínculo, cai em `transportadora_nome` como
   * sempre — é lá que vive a transportadora sem cadastro, e é o que o campo
   * livre do modal continua alimentando.
   *
   * NÃO HÁ BACKFILL: pedidos antigos sem vínculo seguem imprimindo o que está
   * gravado, inclusive quando o que está gravado é um serviço.
   *
   * Continua sob o gate de `expConfirmado`, junto com rastreio e obs: rascunho
   * de despacho não vai para a etiqueta. Só o endereço escapa do gate, e isso
   * não muda aqui.
   */
  let nomeTransportadoraCadastro = "";
  if (expConfirmado?.id_transportadora_cliente) {
    const { data: transp } = await supabase
      .from("clientes")
      .select("nome, fantasia")
      .eq("id_cliente", expConfirmado.id_transportadora_cliente)
      .maybeSingle();
    nomeTransportadoraCadastro = String(transp?.fantasia || transp?.nome || "").trim();
  }

  /**
   * TRANSPORTADORA DO ORÇAMENTO — só para não imprimir "SEDEX" (02/09/2026).
   *
   * Sem despacho confirmado, o campo caía em `frete?.servico`, e a etiqueta de
   * um envio FOB pela SVT saía com **SEDEX** carimbado: o mesmo resíduo de
   * cotação zerada que já contaminou o Kanban (`e1855ed`), o alerta (`dee4819`)
   * e o formulário (`d87b61f`). Aqui ele ia para o PAPEL.
   *
   * Busca só acontece quando NÃO há despacho confirmado e a proposta tem
   * vínculo — nos despachados o nome já veio do bloco acima e nada muda.
   */
  let nomeTransportadoraOrcamento = "";
  if (!expConfirmado && proposta.id_transportadora_cliente) {
    const { data: transpOrc } = await supabase
      .from("clientes")
      .select("nome, fantasia")
      .eq("id_cliente", proposta.id_transportadora_cliente)
      .maybeSingle();
    nomeTransportadoraOrcamento = String(transpOrc?.fantasia || transpOrc?.nome || "").trim();
  }

  /**
   * ENDERECO ESCOLHIDO TEM PRECEDENCIA ABSOLUTA (24/08/2026).
   *
   * Le `exp.id_endereco_entrega` direto, FORA do gate `expConfirmado`. Antes a
   * selecao de endereco passava por ele, e sem `data_despacho` o endereco que o
   * expedidor escolheu era descartado: caia no fallback e a etiqueta imprimia o
   * mais recente do cliente. Casos comprovados — 21000 (escolhido Santa Cruz do
   * Sul-RS, impresso Garanhuns-PE, com o recebedor errado junto) e 21055
   * (escolhido Porto Alegre-RS, impresso Garanhuns-PE).
   *
   * Alinha com o que a prepostagem dos Correios ja faz em
   * `api/expedicao/correios/prepostagem/route.ts:74`: la o campo sempre foi
   * lido sem gate, e e o comportamento correto — o endereco e escolha explicita
   * de quem despacha, nao dado que so vale depois de confirmar.
   *
   * O GATE NAO FOI REMOVIDO. Ele segue governando transportadora, codigo de
   * rastreamento e obs, que continuam saindo so com despacho confirmado. Quem
   * saiu de baixo dele foi apenas o ENDERECO.
   *
   * Sem escolha gravada, a cadeia de fallback abaixo continua identica: o
   * endereco que casa com o CEP cotado, e depois o mais recente do cliente.
   */
  /**
   * DESDE 02/09/2026 A PRECEDÊNCIA É A MESMA DO MODAL, e vem de
   * `lib/endereco-entrega.ts` — regra única, sem cópia.
   *
   * Antes, sem `id_endereco_entrega` gravado, este documento pulava direto para
   * o palpite abaixo e imprimia o endereço MAIS RECENTE DO CLIENTE. No 21503 a
   * tela dizia Santarém/PA e o papel saía com Garanhuns/PE, do cadastro 8469.
   * O palpite continua existindo, mas agora só como último recurso.
   */
  const idEnderecoVigente = idEnderecoEntregaVigente({
    despachoConfirmado: Boolean(expConfirmado),
    idGravadoNoDespacho: exp?.id_endereco_entrega as string | null | undefined,
    idDefinidoNaProposta: proposta.id_endereco_ent as string | null | undefined
  });
  if (idEnderecoVigente) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor")
      .eq("id", idEnderecoVigente)
      .maybeSingle();
    endereco = data ?? null;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor, data_criacao")
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = (frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }

  /**
   * EM NOME DE QUEM A ETIQUETA SAI (24/08/2026).
   *
   * Escolhido no despacho quando o pagador difere do cliente; `null` mantem o
   * cliente da proposta, que e como sempre foi. A validacao vive em
   * `resolverIdDestinatarioEtiqueta`: id que nao seja o cliente nem o pagador
   * cai no cliente — a escrita nao passa por servidor nenhum, entao a guarda
   * precisa estar aqui, na leitura.
   *
   * O ENDERECO NAO ENTRA NESTA CONTA. Ele e escolha separada e independente:
   * a caixa pode ir para um endereco do pagador em nome do cliente, e vice-versa.
   * Por isso o destinatario e um campo proprio, e nao deduzido do endereco.
   */
  const idDestinatario = idDestinatarioEtiquetaVigente({
    despachoConfirmado: Boolean(expConfirmado),
    idClienteProposta: idCliente,
    idFaturado:
      proposta.id_faturado !== null && proposta.id_faturado !== undefined
        ? Number(proposta.id_faturado)
        : null,
    idGravadoNoDespacho: exp?.id_cliente_destinatario_etiqueta as number | null | undefined
  });

  const { data: cliente } = idDestinatario !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, documento, whatsapp_1, telefone_fixo, cidade_uf")
        .eq("id_cliente", idDestinatario)
        .maybeSingle()
    : { data: null };

  /**
   * REMETENTE, do cadastro (02/09/2026).
   *
   * Passou a usar `resolverEmpresaRemetente` — a MESMA funcao da Declaracao de
   * Conteudo e da prepostagem —, no lugar da consulta local que existia aqui.
   * Motivo: o layout novo imprime o BLOCO inteiro (nome, logradouro, numero,
   * bairro, municipio, UF), e nao so o nome; manter uma segunda consulta com
   * outro `select` seria manter uma segunda verdade sobre o mesmo cadastro.
   *
   * A REGRA DO 8469 CONTINUA, e so sobre o NOME (decisao do dono, 02/09/2026):
   * os 20 pedidos do cliente 8469 sao emitidos pela E3 Brindes e o volume sai
   * em nome de DSEG BRASIL — e white-label, o destinatario final nao ve a
   * grafica. O ENDERECO vem do cadastro normalmente, porque e para la que a
   * transportadora devolve o que nao entrega.
   */
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  const empresaRow = await resolverEmpresaRemetente(supabase, nomeEmpresa);

  const remetenteNome = nomeRemetenteExibido(
    idCliente,
    empresaRow?.nome_fantasia || empresaRow?.razao_social || nomeEmpresa
  );
  const remetenteLogradouro = [empresaRow?.logradouro, empresaRow?.numero].filter(Boolean).join(", ");
  const remetenteBairroCidadeUf = [
    empresaRow?.bairro ? `BAIRRO ${empresaRow.bairro}` : "",
    [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join("/")
  ]
    .filter(Boolean)
    .join(", ");

  const volumes = Math.max(1, Number(exp?.qtd_volumes) || 1);
  // Precedência única (lib/peso.ts): aferido > bruto da revisão > cotado.
  const pesoKg = fmtPeso(
    resolverPesoExpedicao({
      pesoAferidoKg: exp?.peso_kg,
      pesoBrutoKg: exp?.peso_bruto_kg,
      pesoCotadoGramas: frete?.peso
    }).pesoKg
  );

  const cidadeUf = endereco
    ? [endereco.cidade, endereco.uf].filter(Boolean).join(" - ")
    : (cliente?.cidade_uf ?? "");

  return {
    idInt,
    volumes,
    pesoKg,
    /**
     * O último degrau deixou de ser o texto cru da cotação (02/09/2026):
     * `nomeTransporteEfetivo` é a MESMA função que a coluna FRETE da lista e o
     * Kanban usam, e sob FOB ela devolve o nome do cadastro em vez do "SEDEX"
     * que ninguém contratou. Fora de FOB o comportamento é idêntico ao de
     * antes — ela devolve o próprio serviço cotado.
     */
    transportadora:
      nomeTransportadoraCadastro ||
      expConfirmado?.transportadora_nome ||
      nomeTransporteEfetivo(
        frete?.servico as string | null | undefined,
        proposta.modalidade_frete as ModalidadeFrete | null | undefined,
        nomeTransportadoraOrcamento
      ) ||
      "",
    codigoRastreamento: expConfirmado?.codigo_rastreamento || os?.codigo_rastreamento || "",
    obs: expConfirmado?.obs || "",
    /**
     * NUMERO DA NF: `notas_fiscais` SEMPRE VENCE, `nf_numero_manual` e fallback.
     *
     * A nota autorizada e escolhida por `escolherNotaAutorizadaDoPedido`, o
     * mesmo criterio da lista e do modal. So quando NAO ha nenhuma o campo
     * digitado a mao responde — remessa sem NF, devolucao, brinde. O manual nao
     * passa pelo gate de `expConfirmado`: a etiqueta costuma sair antes do
     * despacho, e segurar o numero ate la deixaria o rodape vazio justamente
     * nesses casos.
     */
    nfNumero: nfAutorizada?.numero_nf
      ? String(nfAutorizada.numero_nf)
      : String(exp?.nf_numero_manual ?? "").trim(),
    tipoVolume: exp?.tipo_volume || "",
    /**
     * `obs_etiqueta`, NAO `obs`. Sem gate de `expConfirmado` pelo mesmo motivo
     * do endereco: a etiqueta e impressa antes do despacho, e a observacao
     * existe justamente para acompanhar o volume desde ali.
     */
    obsEtiqueta: String(exp?.obs_etiqueta ?? "").trim(),
    /**
     * DATA DE ENVIO: `data_despacho` quando ja houve despacho; senao HOJE.
     *
     * Reimprimir a etiqueta de um pedido despachado tem de repetir a data que
     * saiu no papel anterior — por isso o despacho vence. Antes do despacho nao
     * existe data nenhuma, e a etiqueta e impressa para colar no volume agora:
     * a data de hoje e a informacao verdadeira nesse momento.
     */
    dataEnvio: new Date(exp?.data_despacho ?? Date.now()).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    }),
    remetente: {
      nome: remetenteNome,
      logradouro: remetenteLogradouro,
      bairroCidadeUf: remetenteBairroCidadeUf
    },
    remetenteRodape: [remetenteNome, [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join(" - ")]
      .filter(Boolean)
      .join("  ·  "),
    destinatario: {
      // NOME PURO, SEM O NÚMERO DO CADASTRO (26/08/2026, layout aprovado).
      //
      // A etiqueta 10x15 deixou de usar `rotuloClienteComNumero`: o "28449 - "
      // na frente serve à CONFERÊNCIA INTERNA, onde cadastros de nome parecido
      // precisam ser desambiguados. Colado no volume, o número não é lido por
      // ninguém — nem pelo entregador, nem por quem recebe — e disputa espaço
      // com o nome, que é o que importa ali.
      //
      // A regra continua valendo em TODO o resto: lista da Expedição,
      // DespacharModal e etiqueta de retirada seguem chamando o helper, que
      // ficou intocado. O que mudou é só este documento.
      //
      // `proposta.cliente` e o nome do CLIENTE gravado na proposta: so serve
      // quando o destinatario e ele. Escolhido o pagador, o nome tem de vir do
      // cadastro dele — usar o texto da proposta imprimiria o nome errado.
      nome:
        idDestinatario === idCliente
          ? proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido #${idInt}`
          : cliente?.nome || cliente?.fantasia || `Cadastro ${idDestinatario}`,
      recebedor: endereco?.recebedor || "",
      endereco: endereco
        ? [[endereco.endereco, endereco.numero].filter(Boolean).join(", "), endereco.complemento]
            .filter(Boolean)
            .join(" - ")
        : "",
      bairro: endereco?.bairro ?? "",
      cidadeUf,
      cep: fmtCep(endereco?.cep),
      documento: fmtDocumento(cliente?.documento),
      // O PRIMEIRO CANDIDATO QUE E TELEFONE (04/09/2026), nao o primeiro
      // preenchido: `whatsapp_1` do cadastro 248 guardava o NOME do cliente e
      // a etiqueta do 21000 saiu com "Fone: FELIPE FAUTH PROBST". Regra unica
      // em `lib/telefone-destinatario.ts`, a mesma do contato exibido no modal.
      //
      telefone: telefoneDestinatario(cliente?.whatsapp_1, cliente?.telefone_fixo)
    }
  };
}
