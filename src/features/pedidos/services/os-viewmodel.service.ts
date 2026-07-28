import type { SupabaseClient } from "@supabase/supabase-js";
import { obterPedidoOperacionalPorIdOuIdInt } from "./pedidos-detalhe.service";
import { parsePedidosObs, obterFreteEscolhido } from "./boletim-propostas.service";
import type { ParsedObs } from "./boletim-propostas.service";
import { empresaTextoParaId, EMPRESA_NOMES } from "../pdf/os-pdf-assets";
import type { EmpresaId } from "../pdf/os-pdf-assets";

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
    try {
      const { data: propostaRow } = await client
        .from("propostas")
        .select("cliente, cnpjCpf, contato, empresa, vendedor, status_interno, id_cliente")
        .eq("id_int", idInt)
        .maybeSingle();
      if (propostaRow) {
        cnpjCpf = propostaRow.cnpjCpf ? String(propostaRow.cnpjCpf) : null;
        contato = propostaRow.contato ? String(propostaRow.contato) : null;
        statusInterno = propostaRow.status_interno ? String(propostaRow.status_interno) : "";
        if (propostaRow.id_cliente !== null && propostaRow.id_cliente !== undefined) {
          idCliente = Number(propostaRow.id_cliente);
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
    try {
      const { data: empresaRow } = await client
        .from("empresas")
        .select("id, empresa, cnpj")
        .eq("id", empresaId)
        .maybeSingle();
      if (empresaRow) {
        empresaNome = String(empresaRow.empresa || empresaNome);
        empresaCnpj = empresaRow.cnpj ? String(empresaRow.cnpj) : null;
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar empresa (não-fatal):", e);
    }

    // Cadastro do boletim + anexos do briefing (pedidos_artes). Setor e hora são
    // campos próprios do boletim. Com idBoletim, o boletim é escolhido pelo seu
    // id (identidade estável); sem ele, mantém o legado da linha mais recente.
    let boletimId: string | null = null;
    let boletimSetor: string | null = null;
    let boletimPrazo: string | null = null;
    let boletimHora: string | null = null;
    let boletimEvento: string | null = null;
    const artesGerais: OsPdfArteRef[] = [];
    try {
      const { data: artesRows } = await client
        .from("pedidos_artes")
        .select("id, setor, prazo, hora, nome_evento, arquivos, created_at")
        .eq("id_int", idInt)
        .order("created_at", { ascending: false });
      const linhas = artesRows || [];
      const boletimRow = opts.idBoletim
        ? linhas.find((r) => String(r.id) === String(opts.idBoletim))
        : linhas[0];
      if (boletimRow) {
        boletimId = String(boletimRow.id);
        boletimSetor = boletimRow.setor ? String(boletimRow.setor) : null;
        boletimPrazo = boletimRow.prazo ? String(boletimRow.prazo) : null;
        boletimHora = boletimRow.hora ? String(boletimRow.hora) : null;
        boletimEvento = boletimRow.nome_evento ? String(boletimRow.nome_evento) : null;
      }
      for (const row of linhas) {
        const arquivos: ArquivoJsonb[] = Array.isArray(row.arquivos) ? row.arquivos : [];
        artesGerais.push(...arquivos.map((a) => arquivoParaArteRef(client, a)));
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar cadastro do boletim/artes (não-fatal):", e);
    }

    // Imagem do modelo: pedidos_modelos.arte_url (oficial) + amostra renderizada
    // como alternativa quando a arte é PDF/vetor (não renderizável no PDF).
    // `setor` define a que boletim cada modelo pertence.
    const imagemPorModelo = new Map<string, { url: string | null; fallback: string | null }>();
    const setorPorModelo = new Map<string, string | null>();
    try {
      const { data: modelosRows } = await client
        .from("pedidos_modelos")
        .select("id, setor, arte_url, amostra_arte_base64")
        .eq("id_int", idInt);
      for (const row of modelosRows || []) {
        imagemPorModelo.set(String(row.id), {
          url: row.arte_url ? String(row.arte_url) : null,
          fallback: row.amostra_arte_base64 ? String(row.amostra_arte_base64) : null
        });
        setorPorModelo.set(String(row.id), row.setor ? String(row.setor) : null);
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar arte_url dos modelos (não-fatal):", e);
    }

    // Peso total por produto (produtos_proposta.peso_total, em gramas).
    const pesoPorProduto = new Map<number, number>();
    try {
      const { data: pesosRows } = await client
        .from("produtos_proposta")
        .select("id, peso_total")
        .eq("id_int", idInt);
      for (const row of pesosRows || []) {
        if (row.peso_total !== null && row.peso_total !== undefined) {
          pesoPorProduto.set(Number(row.id), Number(row.peso_total));
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar peso dos produtos (não-fatal):", e);
    }

    // Frete escolhido (apenas dados não-monetários).
    let frete: OsPdfViewModel["frete"] = null;
    try {
      const freteRow = await obterFreteEscolhido(idInt, client);
      if (freteRow) {
        const transportadora =
          freteRow.transportadora || freteRow.nome_transportadora || freteRow.transportador || null;
        const servico = freteRow.servico || freteRow.tipo_servico || freteRow.modalidade || null;
        if (transportadora || servico) {
          frete = {
            transportadora: transportadora ? String(transportadora) : null,
            servico: servico ? String(servico) : null
          };
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar frete (não-fatal):", e);
    }

    const obs = parsePedidosObs(pedido.obs);

    // Modelos deste boletim. Quando o boletim tem setor, o PDF mostra apenas os
    // modelos daquele setor; o produto entra no card por ter modelos ali — nunca
    // é duplicado entre setores. Sem setor (legado), nada é filtrado.
    const pertenceAoBoletim = (idModelo: string) =>
      !boletimSetor || (setorPorModelo.get(idModelo) ?? null) === boletimSetor;

    const produtos: OsPdfProduto[] = (pedido.produtos || []).map((prod) => ({
      codigo: prod.idProduto ?? null,
      nome: prod.nome,
      quantidade: prod.quantidade,
      setor: prod.setor,
      pesoTotalGramas: prod.db_id !== undefined ? pesoPorProduto.get(prod.db_id) ?? null : null,
      modelos: (prod.modelos || []).filter((m) => pertenceAoBoletim(String(m.id))).map((m) => {
        const imagens = imagemPorModelo.get(String(m.id));
        const artes: OsPdfArteRef[] = [];
        if (imagens?.url) {
          const nome = imagens.url.split("/").pop() || "arte";
          artes.push({ nomeArquivo: nome, mimeType: mimeFromNome(nome), publicUrl: imagens.url });
        }
        return {
          codigo: /^\d+$/.test(String(m.id)) ? String(m.id) : null,
          imagemUrl: imagens?.url ?? null,
          imagemFallbackUrl: imagens?.fallback ?? null,
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
    const resumoPorSetor = new Map<string, { produto: string; quantidade: number }[]>();
    for (const prod of pedido.produtos || []) {
      for (const m of prod.modelos || []) {
        const setorDoModelo = setorPorModelo.get(String(m.id)) ?? null;
        if (!setorDoModelo || setorDoModelo === boletimSetor) continue;
        const lista = resumoPorSetor.get(setorDoModelo) || [];
        lista.push({ produto: m.nomeModelo || prod.nome, quantidade: m.quantidade });
        resumoPorSetor.set(setorDoModelo, lista);
      }
    }
    const outrosSetores = Array.from(resumoPorSetor.entries())
      .map(([setor, itens]) => ({ setor, itens }))
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
