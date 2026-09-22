import type { SupabaseClient } from "@supabase/supabase-js";
import { obterPedidoOperacionalPorIdOuIdInt } from "./pedidos-detalhe.service";
import { parsePedidosObs, obterFreteEscolhido } from "./boletim-propostas.service";
import type { ParsedObs } from "./boletim-propostas.service";
import { normalizarSetor } from "../setores";
// O MESMO rotulo da lista da Expedicao e da etiqueta de retirada: o formato do
// numero do cadastro vive num lugar so, para as tres pecas nao divergirem.
import { rotuloClienteComNumero } from "@/features/expedicao/lib/cliente-rotulo";
import { empresaTextoParaId, EMPRESA_NOMES } from "../pdf/os-pdf-assets";
import type { EmpresaId } from "../pdf/os-pdf-assets";
import {
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo,
  type ModalidadeFrete
} from "@/features/orcamentos/lib/modalidade-frete";
import { idEnderecoEntregaVigente } from "@/features/expedicao/lib/endereco-entrega";
import {
  idDestinatarioEtiquetaVigente,
  nomeDestinatarioVigente
} from "@/features/expedicao/lib/destinatario-etiqueta";

/**
 * View-model único da OS, compartilhado entre a tela do boletim e o PDF.
 * Client-agnóstico: recebe o SupabaseClient injetado (browser na tela, Bearer na rota do PDF).
 * v1: `valores` é sempre null — a versão de produção nunca carrega dados financeiros em memória.
 */

export interface OsPdfArteRef {
  nomeArquivo: string;
  mimeType: string;
  publicUrl: string | null;
  /** Preenchido pela rota (pré-fetch server-side) apenas para mimes image/*. */
  imagemDataUrl?: string | null;
}

export interface OsPdfModelo {
  /** Código do modelo (pedidos_modelos.id) — impresso no card como "MODELO:". */
  codigo: string | null;
  nomeModelo: string;
  quantidade: number;
  tipoNumeracao: string;
  numeracaoInicio?: number;
  numeracaoFim?: number;
  corMaterial?: string;
  frenteVerso: boolean;
  rfid: boolean;
  gabarito?: string;
  obsTecnicas?: string;
  artes: OsPdfArteRef[];
  /** Imagem do modelo — pedidos_modelos.arte_url (fonte oficial). */
  imagemUrl: string | null;
  /** Amostra renderizada (pedidos_modelos.amostra_arte_base64) — usada quando arte_url não é raster. */
  imagemFallbackUrl: string | null;
  /** Preenchido pela rota (pré-fetch server-side) a partir das URLs acima. */
  imagemDataUrl?: string | null;
}

export interface OsPdfProduto {
  /** Código do catálogo (produtos_proposta.id_produto) — ex.: "101 - Pulseira Triband". */
  codigo: number | null;
  nome: string;
  quantidade: number;
  setor?: string;
  /** produtos_proposta.peso_total, em gramas. */
  pesoTotalGramas: number | null;
  /**
   * Produto de prateleira (produtos_proposta.is_estoque). Vendido pronto: o card
   * do PDF esconde numeração, gabarito e frente/verso, e a imagem é a prévia da
   * cor do papel — a mesma que a aba Pedido mostra.
   */
  isEstoque: boolean;
  /**
   * Checklist do boletim CONGELADO na venda deste item
   * (`produtos_proposta_boletim_campos`), quando
   * `produtos_proposta.boletim_campos_congelado_em` está preenchida.
   *
   *   `null`  = item SEM snapshot: o card imprime exatamente como sempre
   *             imprimiu, `isEstoque` incluído. É o caso de todo item anterior
   *             à virada, e não há backfill.
   *   `[]`    = tem snapshot e nenhum campo opcional: só os três obrigatórios.
   *   lista   = imprime esses campos opcionais, e nada além deles.
   */
  boletimCampos: string[] | null;
  /**
   * Variações escolhidas na venda (`produtos_proposta_variacao`), já no formato
   * "GRUPO: opção" e na ordem em que o vendedor as escolheu. Só vão ao papel
   * quando `variacoes` está no snapshot acima.
   */
  variacoes: string[];
  modelos: OsPdfModelo[];
}

export interface OsPdfViewModel {
  idInt: number;
  os: {
    emissao: string;
    prazo: string | null;
    statusPedido: string;
    statusProducao: string;
    statusInterno: string;
  };
  /**
   * O boletim (pedidos_artes) deste PDF. A proposta pode ter vários — um por
   * setor —, todos vinculados ao mesmo id_int. `id` é a identidade estável.
   */
  boletim: {
    id: string | null;
    setor: string | null;
    hora: string | null;
    evento: string | null;
    /**
     * Nome do PAGADOR a imprimir no campo EVENTO, e null fora da regra do
     * cliente 8469 (ver `eventoDoPagadorLisiton`). Campo proprio, e nao um
     * `evento` preenchido, porque o PDF precisa distinguir os dois: este passa
     * pela guarda `somenteEstoque`, o `evento` normal nao.
     */
    eventoDoPagador: string | null;
    /** O que os demais boletins da proposta produzem, para o resumo do rodapé. */
    outrosSetores: { setor: string; itens: { produto: string; quantidade: number }[] }[];
  };
  empresa: { id: EmpresaId; nome: string; cnpj: string | null };
  cliente: {
    /**
     * "12460 - Alexandre Machado De Macedo": o número do cadastro antes do
     * nome, pelo MESMO `rotuloClienteComNumero` que a lista da Expedição e a
     * etiqueta de retirada usam. Sem cadastro vinculado vem só o nome — o
     * helper não deixa separador solto.
     */
    nome: string;
    documento: string | null;
    contato: string | null;
    telefone: string | null;
  };
  vendedor: string;
  designer: string | null;
  obs: ParsedObs;
  /**
   * Orientação técnica de produção (`propostas.obs_tecnica`). Vem da PROPOSTA,
   * não do texto etiquetado de `propostas_os.obs`, e sai INTEIRA no PDF — sem o
   * corte de 200 caracteres que vale para os outros campos de observação, que
   * são notas curtas por setor. Esta é a instrução de fabricação: truncar
   * mudaria o que a bancada faz.
   */
  obsTecnica: string;
  frete: { transportadora: string | null; servico: string | null } | null;
  /**
   * PARA ONDE O PEDIDO VAI (18/09/2026) — o bloco de entrega do boletim.
   *
   * MESMA ORIGEM DA EXPEDICAO: o endereco vigente sai de
   * `idEnderecoEntregaVigente` (escolha do despacho › endereco da proposta) e o
   * nome, de `nomeDestinatarioVigente` (escolha gravada › `enderecos.recebedor`
   * › o nome do cadastro). Uma regra so para o papel da bancada, a etiqueta e a
   * prepostagem — nenhuma copia.
   *
   * `null` quando o pedido NAO tem endereco de entrega escolhido (RETIRA, por
   * exemplo): o boletim nao imprime o bloco e o layout fica como era. O palpite
   * por CEP que a etiqueta ainda faz NAO entra aqui: no boletim, endereco que
   * ninguem escolheu e pior que nenhum.
   */
  entrega: {
    recebedor: string;
    endereco: string;
    bairro: string;
    cep: string;
    cidadeUf: string;
  } | null;
  produtos: OsPdfProduto[];
  /** Arquivos do briefing de artes sem vínculo com modelo específico. */
  artesGerais: OsPdfArteRef[];
  /** v1 (produção): sempre null. Seam para a futura variante administrativa. */
  valores: null;
}

export type MontarOsPdfViewModelResult =
  | { success: true; vm: OsPdfViewModel }
  | { success: false; error: string; status: 404 | 500 };

type ArquivoJsonb = {
  nome_arquivo?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
};

function mimeFromNome(nome: string): string {
  const lower = nome.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function arquivoParaArteRef(client: SupabaseClient, arquivo: ArquivoJsonb): OsPdfArteRef {
  const nome = String(arquivo.nome_arquivo || "arquivo");
  let publicUrl: string | null = null;
  if (arquivo.storage_bucket && arquivo.storage_path) {
    const { data } = client.storage.from(arquivo.storage_bucket).getPublicUrl(arquivo.storage_path);
    publicUrl = data?.publicUrl || null;
  }
  return {
    nomeArquivo: nome,
    mimeType: String(arquivo.mime_type || mimeFromNome(nome)),
    publicUrl
  };
}

/**
 * Cliente cujo boletim imprime o PAGADOR no campo EVENTO.
 * 8469 = LISITON DOCUMENTOS SEGUROS LTDA.
 */
const CLIENTE_EVENTO_DO_PAGADOR = 8469;

/**
 * EVENTO com o nome do pagador, no boletim do cliente 8469 (24/08/2026).
 *
 * SEGUNDA REGRA FIXA PARA O 8469 NO SISTEMA
 *   A primeira e o rodape "DSEG BRASIL" da etiqueta 10x15
 *   (`etiqueta-viewmodel.service.ts`, `nomeRemetenteExibido`). As duas sao
 *   EXIBICAO e so valem para este cadastro; nenhuma grava nada. Se aparecer uma
 *   terceira, e hora de discutir se isso vira cadastro em vez de constante.
 *
 * POR QUE
 *   O 8469 compra so produto de prateleira, que nao tem arte: dos 317 pedidos
 *   dele, 314 nao tem uma linha em `pedidos_artes`. Sem arte nao ha
 *   `nome_evento`, e a guarda `somenteEstoque` do PDF corta o campo EVENTO por
 *   inteiro — o boletim dele sai sempre sem essa informacao. Como boa parte
 *   desses pedidos e paga por um terceiro, quem esta na bancada nao tem como
 *   saber para quem aquilo vai. O nome do pagador ocupa o espaco que estaria
 *   vazio de qualquer jeito.
 *
 * AS TRES CONDICOES, TODAS NECESSARIAS
 *   1. o CLIENTE da proposta e o 8469 — nao o pagador. Pagador 8469 com cliente
 *      outro NAO ativa a regra, mesmo criterio da etiqueta;
 *   2. existe pagador distinto do cliente;
 *   3. NAO ha `nome_evento`. Havendo, ele vence e nada muda — os 3 pedidos do
 *      8469 que tem arte (19443, 19370, 17974) seguem imprimindo o evento
 *      deles, e nenhum dos tres tem pagador distinto de qualquer forma.
 *
 * Devolve null fora disso, e ai o PDF se comporta exatamente como antes.
 */
function eventoDoPagadorLisiton(
  idCliente: number | null,
  idFaturado: number | null,
  nomeEvento: string | null,
  nomePagador: string | null
): string | null {
  if (idCliente !== CLIENTE_EVENTO_DO_PAGADOR) return null;
  if (idFaturado === null || idFaturado === idCliente) return null;
  if ((nomeEvento || "").trim() !== "") return null;
  return (nomePagador || "").trim() || null;
}

export async function montarOsPdfViewModel(
  client: SupabaseClient,
  idInt: number,
  opts: {
    incluirValores: boolean;
    /** Boletim (pedidos_artes.id) a imprimir. Ausente = legado: boletim mais recente, sem filtro de setor. */
    idBoletim?: string | null;
  }
): Promise<MontarOsPdfViewModelResult> {
  try {
    const pedido = await obterPedidoOperacionalPorIdOuIdInt(idInt, client);

    // Sem registro real em propostas_os (pedido nulo ou sintético) → OS não existe.
    if (!pedido || !pedido.id) {
      return { success: false, error: "OS (boletim) não encontrada para esta proposta.", status: 404 };
    }

    // Enriquecimento com a proposta (tolerante a falha — a rota já validou existência/liberação).
    let cnpjCpf: string | null = null;
    let contato: string | null = null;
    let statusInterno = "";
    let idCliente: number | null = pedido.idCliente || null;
    /** `propostas.id_faturado` — o pagador. Usado so pela regra do 8469. */
    let idFaturado: number | null = null;
    /** Modalidade declarada pelo vendedor — decide o rótulo de FORMA DE ENVIO. */
    let modalidadeFrete: ModalidadeFrete | null = null;
    let idTransportadoraCliente: number | null = null;
    /** `propostas.id_endereco_ent` — o endereco de entrega escolhido no pedido. */
    let idEnderecoProposta: string | null = null;
    // As leituras abaixo sao independentes entre si: rodam juntas para o PDF nao
    // pagar ~12 idas e voltas em serie ao banco. Cada uma segue tolerante a
    // falha; o encadeamento so existe onde o dado e mesmo pre-requisito
    // (cliente depende do id_cliente que vem da proposta).
    const [
      propostaResult,
      empresaResult,
      artesResult,
      setoresResult,
      modelosResult,
      pesosResult,
      freteResult,
      expedicaoResult
    ] = await Promise.all([
      (async () => {
        try {
          return await client
            .from("propostas")
            .select(
              // `id_faturado` (o PAGADOR) entra na MESMA linha que ja era lida:
              // custo zero. Serve a regra do 8469 logo abaixo.
              // `id_endereco_ent` entra em 18/09/2026, na MESMA linha: e o endereco de
              // entrega do bloco novo do boletim, e nao custa consulta alguma.
              "cliente, cnpjCpf, contato, empresa, vendedor, status_interno, id_cliente, id_faturado, modalidade_frete, id_transportadora_cliente, id_endereco_ent"
            )
            .eq("id_int", idInt)
            .maybeSingle();
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao enriquecer com proposta (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await client
            .from("empresas")
            .select("id, empresa, cnpj")
            .eq("id", empresaTextoParaId(pedido.empresa))
            .maybeSingle();
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar empresa (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await client
            .from("pedidos_artes")
            .select("id, nome_evento, designer_nome, arquivos, created_at")
            .eq("id_int", idInt)
            .order("created_at", { ascending: true });
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar artes (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await client
            .from("propostas_os_setores")
            .select("id, setor, prazo, hora, created_at")
            .eq("id_int", idInt)
            .order("created_at", { ascending: false });
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar boletins de setor (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await client
            .from("pedidos_modelos")
            .select("id, setor, arte_url, amostra_arte_base64")
            .eq("id_int", idInt);
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar arte dos modelos (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await client
            .from("produtos_proposta")
            .select("id, peso_total, boletim_campos_congelado_em")
            .eq("id_int", idInt);
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar peso dos produtos (nao-fatal):", e);
          return { data: null };
        }
      })(),
      (async () => {
        try {
          return await obterFreteEscolhido(idInt, client);
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao buscar frete (nao-fatal):", e);
          return null;
        }
      })(),
      // Escolha do despacho: endereco e destinatario. Uma leitura, no mesmo
      // lote das outras — o bloco de entrega do boletim depende dela.
      (async () => {
        try {
          return await client
            .from("expedicoes")
            .select("id_endereco_entrega, id_cliente_destinatario_etiqueta, data_despacho")
            .eq("id_int", idInt)
            .maybeSingle();
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao ler a expedicao (nao-fatal):", e);
          return { data: null };
        }
      })()
    ]);

    try {
      const propostaRow = propostaResult?.data as Record<string, unknown> | null;
      if (propostaRow) {
        cnpjCpf = propostaRow.cnpjCpf ? String(propostaRow.cnpjCpf) : null;
        contato = propostaRow.contato ? String(propostaRow.contato) : null;
        statusInterno = propostaRow.status_interno ? String(propostaRow.status_interno) : "";
        if (propostaRow.id_cliente !== null && propostaRow.id_cliente !== undefined) {
          idCliente = Number(propostaRow.id_cliente);
        }
        if (propostaRow.id_faturado !== null && propostaRow.id_faturado !== undefined) {
          idFaturado = Number(propostaRow.id_faturado);
        }
        modalidadeFrete = (propostaRow.modalidade_frete as ModalidadeFrete | null) ?? null;
        idEnderecoProposta = propostaRow.id_endereco_ent ? String(propostaRow.id_endereco_ent) : null;
        if (
          propostaRow.id_transportadora_cliente !== null &&
          propostaRow.id_transportadora_cliente !== undefined
        ) {
          idTransportadoraCliente = Number(propostaRow.id_transportadora_cliente);
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao enriquecer com proposta (não-fatal):", e);
    }

    // Telefone/documento do cadastro do cliente (tolerante a falha).
    //
    // A consulta busca DOIS cadastros num `in` so — o cliente e, quando existe e
    // difere, o pagador. Continua sendo UMA ida ao banco, a mesma de antes: o
    // nome do pagador que a regra do 8469 imprime nao custa consulta nova.
    let telefone: string | null = null;
    let documentoCliente: string | null = null;
    let nomePagador: string | null = null;
    const idsCadastro = Array.from(
      new Set([idCliente, idFaturado].filter((n): n is number => Number.isFinite(Number(n)) && Number(n) > 0))
    );
    if (idsCadastro.length > 0) {
      try {
        const { data: clienteRows } = await client
          .from("clientes")
          .select("id_cliente, nome, fantasia, documento, telefone_fixo, whatsapp_1")
          .in("id_cliente", idsCadastro);
        const linhas = (clienteRows || []) as Record<string, unknown>[];
        const clienteRow = linhas.find((r) => Number(r.id_cliente) === Number(idCliente));
        if (clienteRow) {
          telefone = String(clienteRow.telefone_fixo || clienteRow.whatsapp_1 || "") || null;
          documentoCliente = clienteRow.documento ? String(clienteRow.documento) : null;
        }
        if (idFaturado !== null && idFaturado !== idCliente) {
          const pagadorRow = linhas.find((r) => Number(r.id_cliente) === Number(idFaturado));
          // `fantasia` primeiro: e o nome pelo qual a empresa e conhecida e o
          // que o operador reconhece na bancada. O cadastro 471, por exemplo,
          // tem razao social "GR GRAFICA EXPRESSA LTDA" e fantasia "IMPRIMIX
          // GRAFICA EXPRESSA" — imprimir a razao social nao diria nada a
          // producao. Mesma preferencia de `buscarNomesDosSocios` e da coluna
          // do pagador nas listas.
          nomePagador =
            String(pagadorRow?.fantasia ?? "").trim() || String(pagadorRow?.nome ?? "").trim() || null;
        }
      } catch (e) {
        console.warn("[os-viewmodel] Falha ao buscar cadastro do cliente (não-fatal):", e);
      }
    }

    // Empresa vinculada (dados cadastrais do cabeçalho, tolerante a falha).
    const empresaId = empresaTextoParaId(pedido.empresa);
    let empresaNome = EMPRESA_NOMES[empresaId];
    let empresaCnpj: string | null = null;
    {
      const empresaRow = empresaResult?.data as Record<string, unknown> | null;
      if (empresaRow) {
        empresaNome = String(empresaRow.empresa || empresaNome);
        empresaCnpj = empresaRow.cnpj ? String(empresaRow.cnpj) : null;
      }
    }

    // Boletim do setor (propostas_os_setores) + anexos do briefing
    // (pedidos_artes). Com idBoletim, o boletim é escolhido pelo seu id
    // (identidade estável); sem ele, mantém o legado da linha mais recente.
    let boletimId: string | null = null;
    let boletimSetor: string | null = null;
    let boletimPrazo: string | null = null;
    let boletimHora: string | null = null;
    let boletimEvento: string | null = null;
    let designerBriefing: string | null = null;
    const artesGerais: OsPdfArteRef[] = [];
    {
      const setoresLinhas = (setoresResult?.data || []) as Record<string, unknown>[];
      const boletimRow = opts.idBoletim
        ? setoresLinhas.find((r) => String(r.id) === String(opts.idBoletim))
        : setoresLinhas[0];
      if (boletimRow) {
        boletimId = String(boletimRow.id);
        boletimSetor = boletimRow.setor ? String(boletimRow.setor) : null;
        boletimPrazo = boletimRow.prazo ? String(boletimRow.prazo) : null;
        boletimHora = boletimRow.hora ? String(boletimRow.hora) : null;
      }

      const linhas = (artesResult?.data || []) as Record<string, unknown>[];
      // O evento é do pedido, não do setor: vale o primeiro briefing que o tenha.
      boletimEvento =
        linhas.map((r) => (r.nome_evento ? String(r.nome_evento) : "")).find((nome) => nome.trim() !== "") ?? null;
      /**
       * O designer é atribuído na aba Artes do orçamento, que grava em
       * `pedidos_artes.designer_nome`. O bloco `[Designer]` do texto livre de
       * `propostas_os.obs` é o formato ANTIGO: nenhuma tela escreve mais nele
       * (`serializePedidosObs` só preserva o que já estivesse lá), então ler só
       * de lá imprimia "DESIGNER: -" mesmo com designer atribuído.
       * Fonte atual primeiro, obs como compatibilidade com pedido antigo.
       */
      designerBriefing =
        linhas
          .map((r) => (r.designer_nome ? String(r.designer_nome) : ""))
          .find((nome) => nome.trim() !== "") ?? null;
      for (const row of linhas) {
        const arquivos: ArquivoJsonb[] = Array.isArray(row.arquivos) ? row.arquivos : [];
        artesGerais.push(...arquivos.map((a) => arquivoParaArteRef(client, a)));
      }
    }

    // Imagem do modelo: pedidos_modelos.arte_url (oficial) + amostra renderizada
    // como alternativa quando a arte é PDF/vetor (não renderizável no PDF).
    // `setor` define a que boletim cada modelo pertence.
    const imagemPorModelo = new Map<string, { url: string | null; fallback: string | null }>();
    const setorPorModelo = new Map<string, string | null>();
    {
      const modelosRows = (modelosResult?.data || []) as Record<string, unknown>[];
      for (const row of modelosRows) {
        imagemPorModelo.set(String(row.id), {
          url: row.arte_url ? String(row.arte_url) : null,
          fallback: row.amostra_arte_base64 ? String(row.amostra_arte_base64) : null
        });
        setorPorModelo.set(String(row.id), row.setor ? String(row.setor) : null);
      }
    }

    // Prévia da cor do papel: mesma fonte que a aba Pedido usa no card do
    // modelo (producao_cores.preview_base64, casando por `name`). Só interessa a
    // produto de prateleira, que não tem arte — a cor é o que se vê.
    const previaPorCor = new Map<string, string>();
    try {
      const coresDeEstoque = Array.from(
        new Set(
          (pedido.produtos || [])
            .filter((prod) => prod.isEstoque === true)
            .flatMap((prod) => (prod.modelos || []).map((m) => (m.corMaterial || "").trim()))
            .filter((cor) => cor !== "")
        )
      );
      if (coresDeEstoque.length > 0) {
        const { data: coresRows } = await client
          .from("producao_cores")
          .select("name, preview_base64")
          .in("name", coresDeEstoque);
        for (const row of coresRows || []) {
          const previa = row.preview_base64 ? String(row.preview_base64).trim() : "";
          if (previa) previaPorCor.set(String(row.name), previa);
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar prévia da cor do papel (não-fatal):", e);
    }

    // Peso total por produto (produtos_proposta.peso_total, em gramas).
    const pesoPorProduto = new Map<number, number>();
    /** Itens com `boletim_campos_congelado_em` preenchida: têm snapshot. */
    const itensComSnapshot = new Set<number>();
    {
      const pesosRows = (pesosResult?.data || []) as Record<string, unknown>[];
      for (const row of pesosRows) {
        if (row.peso_total !== null && row.peso_total !== undefined) {
          pesoPorProduto.set(Number(row.id), Number(row.peso_total));
        }
        if (row.boletim_campos_congelado_em) itensComSnapshot.add(Number(row.id));
      }
    }

    /**
     * CHECKLIST CONGELADO DO BOLETIM (Etapa 5 da reforma).
     *
     * Só é lido para os itens que têm carimbo — item sem carimbo não gera
     * consulta nenhuma e continua imprimindo como sempre imprimiu. Duas leituras
     * no máximo, ambas não-fatais: se falharem, o item cai no comportamento de
     * hoje, que é o lado seguro.
     */
    const camposBoletimPorItem = new Map<number, string[]>();
    const variacoesPorItem = new Map<number, string[]>();
    if (itensComSnapshot.size > 0) {
      const idsComSnapshot = Array.from(itensComSnapshot);

      try {
        const { data: camposRows } = await client
          .from("produtos_proposta_boletim_campos")
          .select("id_produto_proposta, campo")
          .in("id_produto_proposta", idsComSnapshot);

        // Todo item carimbado entra no mapa, inclusive com lista vazia: vazio
        // aqui significa "nenhum opcional", que é diferente de "sem snapshot".
        for (const id of idsComSnapshot) camposBoletimPorItem.set(id, []);
        for (const row of camposRows || []) {
          const id = Number(row.id_produto_proposta);
          camposBoletimPorItem.get(id)?.push(String(row.campo));
        }
      } catch (e) {
        console.warn("[os-viewmodel] Falha ao ler o checklist congelado (não-fatal):", e);
        camposBoletimPorItem.clear();
      }

      // As variações só interessam a quem marcou `variacoes` no snapshot.
      const itensComVariacoes = idsComSnapshot.filter((id) =>
        (camposBoletimPorItem.get(id) || []).includes("variacoes")
      );

      if (itensComVariacoes.length > 0) {
        try {
          const { data: variacoesRows } = await client
            .from("produtos_proposta_variacao")
            .select("id, id_produto_proposta, id_variacao, nome_variacao")
            .in("id_produto_proposta", itensComVariacoes)
            .order("id");

          const linhas = (variacoesRows || []) as unknown as {
            id_produto_proposta: number;
            id_variacao: number | null;
            nome_variacao: string | null;
          }[];

          /**
           * O nome do GRUPO sai numa segunda leitura, e não por um embed
           * `variacoes(nome)`: `produtos_proposta_variacao.id_variacao` NÃO tem
           * chave estrangeira para `variacoes`, então o PostgREST não consegue
           * aninhar as duas e a consulta voltaria vazia — calada.
           */
          const idsGrupo = Array.from(
            new Set(
              linhas
                .map((linha) => Number(linha.id_variacao))
                .filter((id) => Number.isFinite(id) && id > 0)
            )
          );

          const nomePorGrupo = new Map<number, string>();
          if (idsGrupo.length > 0) {
            const { data: gruposRows } = await client
              .from("variacoes")
              .select("id_variacao, nome")
              .in("id_variacao", idsGrupo);
            for (const grupo of gruposRows || []) {
              nomePorGrupo.set(Number(grupo.id_variacao), String(grupo.nome ?? "").trim());
            }
          }

          for (const linha of linhas) {
            const opcao = String(linha.nome_variacao ?? "").trim();
            if (!opcao) continue;
            const grupo = nomePorGrupo.get(Number(linha.id_variacao)) ?? "";
            const id = Number(linha.id_produto_proposta);
            const lista = variacoesPorItem.get(id) ?? [];
            lista.push(grupo ? `${grupo}: ${opcao}` : opcao);
            variacoesPorItem.set(id, lista);
          }
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao ler as variações do snapshot (não-fatal):", e);
        }
      }
    }

    /**
     * BLOCO DE ENTREGA: o endereco vigente e quem recebe.
     *
     * Duas leituras, nao por linha: `expedicoes` (escolha do despacho) e
     * `enderecos` (o endereco em si). Ambas toleram falha — o boletim nunca
     * deixa de sair por causa deste bloco.
     */
    let entrega: OsPdfViewModel["entrega"] = null;
    {
      const exp = (expedicaoResult?.data ?? null) as {
        id_endereco_entrega?: string | null;
        id_cliente_destinatario_etiqueta?: number | null;
        data_despacho?: string | null;
      } | null;

      const idEnderecoVigente = idEnderecoEntregaVigente({
        despachoConfirmado: Boolean(exp?.data_despacho),
        idGravadoNoDespacho: exp?.id_endereco_entrega,
        idDefinidoNaProposta: idEnderecoProposta
      });

      /*
        RETIRA NAO IMPRIME O BLOCO, e a checagem e pela MODALIDADE — nao pela
        ausencia de endereco.

        Medido em 18/09/2026: todo pedido RETIRA tem `id_endereco_ent` gravado
        (o endereco do cadastro viaja junto do pedido de qualquer jeito), entao
        confiar so no "sem endereco" faria o balcao imprimir um destino para
        onde nada vai. Quem busca no balcao nao tem entrega.
      */
      if (modalidadeFrete !== "RETIRA" && idEnderecoVigente) {
        try {
          const { data: end } = await client
            .from("enderecos")
            .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor")
            .eq("id", idEnderecoVigente)
            .maybeSingle();

          if (end) {
            const idDestinatario = idDestinatarioEtiquetaVigente({
              despachoConfirmado: Boolean(exp?.data_despacho),
              idClienteProposta: idCliente,
              idFaturado,
              idGravadoNoDespacho: exp?.id_cliente_destinatario_etiqueta
            });
            entrega = {
              recebedor: nomeDestinatarioVigente({
                idGravadoNoDespacho: exp?.id_cliente_destinatario_etiqueta,
                idDestinatarioResolvido: idDestinatario,
                recebedorDoEndereco: end.recebedor,
                nomeDoCadastro: pedido.clienteNome || ""
              }),
              endereco: [
                [end.endereco, end.numero].filter(Boolean).join(", "),
                end.complemento
              ]
                .filter(Boolean)
                .join(" - "),
              bairro: String(end.bairro ?? ""),
              cep: String(end.cep ?? ""),
              cidadeUf: [end.cidade, end.uf].filter(Boolean).join("/")
            };
          }
        } catch (e) {
          console.warn("[os-viewmodel] Falha ao ler o endereco de entrega (nao-fatal):", e);
        }
      }
    }

    // Frete escolhido (apenas dados não-monetários).
    //
    // FORMA DE ENVIO sob FOB não é o serviço cotado. A cotação continua no banco,
    // escolhida e com o peso real — ela é a referência de preço que ficou
    // registrada, não quem leva a mercadoria. Quem leva é a transportadora que o
    // cliente contratou e o vendedor declarou no orçamento. O PDF compõe
    // "servico - transportadora", então em FOB o par vira "FOB - AVI AZUL" sem
    // que o componente da OS precise mudar.
    let frete: OsPdfViewModel["frete"] = null;
    {
      const freteRow = freteResult;
      const servicoCotado = freteRow
        ? freteRow.servico || freteRow.tipo_servico || freteRow.modalidade || null
        : null;
      const transportadoraCotada = freteRow
        ? freteRow.transportadora || freteRow.nome_transportadora || freteRow.transportador || null
        : null;

      if (modalidadeFrete === "FOB") {
        let nomeCadastro: string | null = null;
        if (idTransportadoraCliente !== null) {
          try {
            const { data: transpRow } = await client
              .from("clientes")
              .select("id_cliente, nome, fantasia")
              .eq("id_cliente", idTransportadoraCliente)
              .maybeSingle();
            nomeCadastro = nomeTransportadoraCadastro(transpRow);
          } catch (e) {
            console.warn("[os-viewmodel] Falha ao resolver transportadora do orçamento (nao-fatal):", e);
          }
        }
        frete = {
          servico: "FOB",
          transportadora: nomeTransporteEfetivo(
            servicoCotado ? String(servicoCotado) : null,
            "FOB",
            nomeCadastro
          )
        };
      } else if (transportadoraCotada || servicoCotado) {
        frete = {
          transportadora: transportadoraCotada ? String(transportadoraCotada) : null,
          servico: servicoCotado ? String(servicoCotado) : null
        };
      }
    }

    const obs = parsePedidosObs(pedido.obs);

    /**
     * Setor efetivo de um lote = setor do PRODUTO (`produtos.setor_pcp`).
     *
     * O setor não é escolha do lote: é consequência do que se está produzindo.
     * `pedidos_modelos.setor` é espelho gravado no save e serve para consulta,
     * mas não pode mandar aqui — o save antigo carimbava nele o setor do boletim
     * aberto, então há lotes TEXTIL/PVC/FLEXO gravados como LASER no banco.
     * Derivando do produto, esses casos se corrigem na leitura, sem migração.
     * O valor gravado só entra quando o produto não tem setor algum.
     */
    const setorEfetivo = (idModelo: string, setorDoProduto: string | null | undefined) =>
      normalizarSetor(setorDoProduto || setorPorModelo.get(idModelo));

    /**
     * O PDF de um setor mostra SÓ os lotes daquele setor — um produto TEXTIL
     * nunca entra na OS do PVC. Boletim sem setor é legado de proposta com um
     * único boletim: aí nada é filtrado, senão o PDF sairia vazio.
     */
    const pertenceAoBoletim = (idModelo: string, setorDoProduto: string | null | undefined) =>
      !boletimSetor || setorEfetivo(idModelo, setorDoProduto) === normalizarSetor(boletimSetor);

    const produtos: OsPdfProduto[] = (pedido.produtos || []).map((prod) => ({
      codigo: prod.idProduto ?? null,
      nome: prod.nome,
      quantidade: prod.quantidade,
      setor: prod.setor,
      pesoTotalGramas: prod.db_id !== undefined ? pesoPorProduto.get(prod.db_id) ?? null : null,
      isEstoque: prod.isEstoque === true,
      // `null` quando o item não tem carimbo: o card mantém o comportamento de
      // hoje, inclusive o ramo isEstoque.
      boletimCampos:
        prod.db_id !== undefined ? camposBoletimPorItem.get(prod.db_id) ?? null : null,
      variacoes: prod.db_id !== undefined ? variacoesPorItem.get(prod.db_id) ?? [] : [],
      modelos: (prod.modelos || []).filter((m) => pertenceAoBoletim(String(m.id), prod.setor)).map((m) => {
        const imagens = imagemPorModelo.get(String(m.id));
        const artes: OsPdfArteRef[] = [];
        if (imagens?.url) {
          const nome = imagens.url.split("/").pop() || "arte";
          artes.push({ nomeArquivo: nome, mimeType: mimeFromNome(nome), publicUrl: imagens.url });
        }
        // Prateleira não tem arte: a imagem do card é a prévia da cor do papel.
        const previaCor = prod.isEstoque === true ? previaPorCor.get((m.corMaterial || "").trim()) : undefined;
        return {
          codigo: /^\d+$/.test(String(m.id)) ? String(m.id) : null,
          imagemUrl: previaCor ?? imagens?.url ?? null,
          imagemFallbackUrl: previaCor ? imagens?.url ?? null : imagens?.fallback ?? null,
          nomeModelo: m.nomeModelo,
          quantidade: m.quantidade,
          tipoNumeracao: m.configImpressao?.tipoNumeracao || "SEM_NUMERACAO",
          numeracaoInicio: m.numeracaoInicial,
          numeracaoFim: m.numeracaoFinal,
          corMaterial: m.corMaterial,
          frenteVerso: m.verso === true,
          rfid: m.configImpressao?.rfid === true,
          gabarito: m.gabaritoNumeracao,
          obsTecnicas: m.observacoesTecnicas,
          artes
        };
      })
    }));

    // Resumo dos demais setores da mesma proposta: o que está sendo produzido
    // fora deste boletim, agrupado por setor (nome do modelo + quantidade).
    // Uma linha por PRODUTO, com a soma dos seus lotes. Antes cada lote virava
    // uma linha e o rótulo era o nome do lote ("1", "2"), o que produzia listas
    // de números sem sentido para quem lê o boletim de outro setor.
    const resumoPorSetor = new Map<string, Map<string, number>>();
    for (const prod of pedido.produtos || []) {
      for (const m of prod.modelos || []) {
        const setorDoModelo = setorEfetivo(String(m.id), prod.setor);
        if (!boletimSetor || setorDoModelo === normalizarSetor(boletimSetor)) continue;
        const porProduto = resumoPorSetor.get(setorDoModelo) || new Map<string, number>();
        const chave = prod.nome || "Produto";
        porProduto.set(chave, (porProduto.get(chave) || 0) + (Number(m.quantidade) || 0));
        resumoPorSetor.set(setorDoModelo, porProduto);
      }
    }
    const outrosSetores = Array.from(resumoPorSetor.entries())
      .map(([setor, porProduto]) => ({
        setor,
        itens: Array.from(porProduto.entries())
          .map(([produto, quantidade]) => ({ produto, quantidade }))
          .sort((a, b) => b.quantidade - a.quantidade)
      }))
      .sort((a, b) => a.setor.localeCompare(b.setor, "pt-BR"));

    // v1: variante administrativa não implementada — valores nunca são consultados.
    void opts.incluirValores;

    const vm: OsPdfViewModel = {
      idInt,
      os: {
        emissao: pedido.dataPedido,
        // Prazo é do boletim; sem ele, cai no prazo do pedido (compatibilidade).
        prazo: boletimPrazo || pedido.dataPrevistaEntrega || null,
        statusPedido: pedido.status_pedido || "",
        statusProducao: pedido.status_producao || "",
        statusInterno
      },
      boletim: {
        id: boletimId,
        setor: boletimSetor,
        hora: boletimHora,
        evento: boletimEvento,
        eventoDoPagador: eventoDoPagadorLisiton(idCliente, idFaturado, boletimEvento, nomePagador),
        outrosSetores
      },
      empresa: { id: empresaId, nome: empresaNome, cnpj: empresaCnpj },
      cliente: {
        // O NÚMERO DO CADASTRO ANTES DO NOME (10/09/2026).
        //
        // A bancada casa volume com cadastro pelo número: homônimos existem, o
        // número não. O boletim era a única peça impressa que saía só com o
        // nome — a etiqueta de retirada já usa este mesmo helper, e é ele que
        // impede a lista e o impresso de divergirem no formato.
        //
        // `idCliente` já estava lido de `propostas.id_cliente` no SELECT lá de
        // cima: nenhuma consulta a mais. Sem cadastro vinculado o helper
        // devolve o nome puro, sem prefixo nem traço órfão.
        nome: rotuloClienteComNumero(idCliente, pedido.clienteNome),
        documento: cnpjCpf || documentoCliente,
        contato,
        telefone
      },
      vendedor: pedido.vendedor,
      designer: designerBriefing || obs.designer?.nome || null,
      obs,
      obsTecnica: pedido.obsTecnica || "",
      frete,
      entrega,
      produtos,
      artesGerais,
      valores: null
    };

    return { success: true, vm };
  } catch (e) {
    console.error("[os-viewmodel] Erro inesperado ao montar view-model:", e);
    return { success: false, error: "Erro interno ao montar os dados da OS.", status: 500 };
  }
}
