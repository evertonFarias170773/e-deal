import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverPesoExpedicao } from "../lib/peso";
import { resolverIdDestinatarioEtiqueta } from "../lib/destinatario-etiqueta";

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
  /** Remetente em uma linha — vai no rodapé: quem manuseia o volume lê o destino. */
  remetenteRodape: string;
  destinatario: {
    nome: string;
    recebedor: string;
    endereco: string;
    bairro: string;
    cidadeUf: string;
    cep: string;
    documento: string;
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

function fmtTelefone(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return String(bruto ?? "").trim();
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
    .select("id_int, cliente, id_cliente, id_faturado, empresa, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const [{ data: exp }, { data: os }, { data: frete }, { data: notas }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select(
        "peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, transportadora_nome, id_transportadora_cliente, codigo_rastreamento, id_endereco_entrega, id_cliente_destinatario_etiqueta, obs, data_despacho"
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
   * A nota que vai para a etiqueta.
   *
   * SÓ AUTORIZADA — nota pendente ou cancelada impressa no volume induziria a
   * conferência a erro. Isso já valia antes.
   *
   * SÓ COM NÚMERO. O pedido 20925 tem uma linha `AUTORIZADA` com `numero_nf`
   * nulo: o número é justamente o que a conferência lê, e uma autorizada sem ele
   * não serve para nada na doca. Sem este filtro, o `.find()` podia parar nela e
   * esconder uma nota boa do mesmo pedido.
   *
   * MAIS RECENTE POR `data_autorizacao`, com `created_at` como desempate — nessa
   * ordem porque o que importa é quando a SEFAZ autorizou, não quando o rascunho
   * nasceu. Antes era `.find()` sobre uma query SEM `order`: com duas
   * autorizadas o resultado dependia da ordem que o Postgres devolvesse, e podia
   * mudar de uma impressão para outra. Existe caso real hoje — o pedido 20370
   * tem a NF 1003 (22/08) e a NF 1005 (23/08), e a etiqueta tem de imprimir a
   * 1005. Nota sem `data_autorizacao` vai para o fim da fila, nunca ganha de uma
   * que tem data.
   */
  const nfAutorizada = (notas ?? [])
    .filter(
      (n) =>
        String(n.status ?? "").toUpperCase() === "AUTORIZADA" &&
        String(n.numero_nf ?? "").trim() !== ""
    )
    .sort((a, b) => {
      const ta = Date.parse(String(a.data_autorizacao ?? "")) || 0;
      const tb = Date.parse(String(b.data_autorizacao ?? "")) || 0;
      if (ta !== tb) return tb - ta;
      const ca = Date.parse(String(a.created_at ?? "")) || 0;
      const cb = Date.parse(String(b.created_at ?? "")) || 0;
      return cb - ca;
    })[0];

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
  if (exp?.id_endereco_entrega) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor")
      .eq("id", exp.id_endereco_entrega)
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
  const idDestinatario = resolverIdDestinatarioEtiqueta(
    idCliente,
    proposta.id_faturado !== null && proposta.id_faturado !== undefined ? Number(proposta.id_faturado) : null,
    exp?.id_cliente_destinatario_etiqueta as number | null | undefined
  );

  const { data: cliente } = idDestinatario !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, documento, whatsapp_1, telefone_fixo, cidade_uf")
        .eq("id_cliente", idDestinatario)
        .maybeSingle()
    : { data: null };

  // Remetente: empresas casada por nome com propostas.empresa; fallback = 1ª linha.
  let empresaRow:
    | { nome_fantasia: string | null; razao_social: string | null; municipio: string | null; uf: string | null }
    | null = null;
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  if (nomeEmpresa) {
    const { data } = await supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, municipio, uf, empresa")
      .or(`empresa.ilike."${nomeEmpresa}",nome_fantasia.ilike."${nomeEmpresa}",razao_social.ilike."${nomeEmpresa}"`)
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }
  if (!empresaRow) {
    const { data } = await supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, municipio, uf")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    empresaRow = data ?? null;
  }

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
    transportadora: nomeTransportadoraCadastro || expConfirmado?.transportadora_nome || frete?.servico || "",
    codigoRastreamento: expConfirmado?.codigo_rastreamento || os?.codigo_rastreamento || "",
    obs: expConfirmado?.obs || "",
    nfNumero: nfAutorizada?.numero_nf ? String(nfAutorizada.numero_nf) : "",
    tipoVolume: exp?.tipo_volume || "",
    remetenteRodape: [
      nomeRemetenteExibido(idCliente, empresaRow?.nome_fantasia || empresaRow?.razao_social || nomeEmpresa),
      [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join(" - ")
    ]
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
      telefone: fmtTelefone(cliente?.whatsapp_1 || cliente?.telefone_fixo)
    }
  };
}
