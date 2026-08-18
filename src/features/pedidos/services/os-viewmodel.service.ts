import type { SupabaseClient } from "@supabase/supabase-js";
import { obterPedidoOperacionalPorIdOuIdInt } from "./pedidos-detalhe.service";
import { parsePedidosObs, obterFreteEscolhido } from "./boletim-propostas.service";
import type { ParsedObs } from "./boletim-propostas.service";
import { normalizarSetor } from "../setores";
import { empresaTextoParaId, EMPRESA_NOMES } from "../pdf/os-pdf-assets";
import type { EmpresaId } from "../pdf/os-pdf-assets";
import {
  nomeTransportadoraCadastro,
  nomeTransporteEfetivo,
  type ModalidadeFrete
} from "@/features/orcamentos/lib/modalidade-frete";

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
    /** O que os demais boletins da proposta produzem, para o resumo do rodapé. */
    outrosSetores: { setor: string; itens: { produto: string; quantidade: number }[] }[];
  };
  empresa: { id: EmpresaId; nome: string; cnpj: string | null };
  cliente: { nome: string; documento: string | null; contato: string | null; telefone: string | null };
  vendedor: string;
  designer: string | null;
  obs: ParsedObs;
  frete: { transportadora: string | null; servico: string | null } | null;
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
    /** Modalidade declarada pelo vendedor — decide o rótulo de FORMA DE ENVIO. */
    let modalidadeFrete: ModalidadeFrete | null = null;
    let idTransportadoraCliente: number | null = null;
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
      freteResult
    ] = await Promise.all([
      (async () => {
        try {
          return await client
            .from("propostas")
            .select(
              "cliente, cnpjCpf, contato, empresa, vendedor, status_interno, id_cliente, modalidade_frete, id_transportadora_cliente"
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
            .select("id, nome_evento, arquivos, created_at")
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
          return await client.from("produtos_proposta").select("id, peso_total").eq("id_int", idInt);
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
        modalidadeFrete = (propostaRow.modalidade_frete as ModalidadeFrete | null) ?? null;
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
    let telefone: string | null = null;
    let documentoCliente: string | null = null;
    if (idCliente) {
      try {
        const { data: clienteRow } = await client
          .from("clientes")
          .select("nome, documento, telefone_fixo, whatsapp_1")
          .eq("id_cliente", idCliente)
          .maybeSingle();
        if (clienteRow) {
          telefone = String(clienteRow.telefone_fixo || clienteRow.whatsapp_1 || "") || null;
          documentoCliente = clienteRow.documento ? String(clienteRow.documento) : null;
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
    {
      const pesosRows = (pesosResult?.data || []) as Record<string, unknown>[];
      for (const row of pesosRows) {
        if (row.peso_total !== null && row.peso_total !== undefined) {
          pesoPorProduto.set(Number(row.id), Number(row.peso_total));
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
        outrosSetores
      },
      empresa: { id: empresaId, nome: empresaNome, cnpj: empresaCnpj },
      cliente: {
        nome: pedido.clienteNome,
        documento: cnpjCpf || documentoCliente,
        contato,
        telefone
      },
      vendedor: pedido.vendedor,
      designer: obs.designer?.nome || null,
      obs,
      frete,
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
