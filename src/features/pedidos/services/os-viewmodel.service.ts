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
}

export interface OsPdfProduto {
  nome: string;
  quantidade: number;
  setor?: string;
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
  opts: { incluirValores: boolean }
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

    // Artes: briefing/anexos de pedidos_artes (JSONB `arquivos`), agrupadas por id_modelo.
    const artesPorModelo = new Map<string, OsPdfArteRef[]>();
    const artesGerais: OsPdfArteRef[] = [];
    try {
      const { data: artesRows } = await client
        .from("pedidos_artes")
        .select("id_modelo, arquivos")
        .eq("id_int", idInt);
      for (const row of artesRows || []) {
        const arquivos: ArquivoJsonb[] = Array.isArray(row.arquivos) ? row.arquivos : [];
        const refs = arquivos.map((a) => arquivoParaArteRef(client, a));
        if (row.id_modelo !== null && row.id_modelo !== undefined) {
          const key = String(row.id_modelo);
          artesPorModelo.set(key, [...(artesPorModelo.get(key) || []), ...refs]);
        } else {
          artesGerais.push(...refs);
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar artes (não-fatal):", e);
    }

    // url_arte direta dos modelos (usada na fila de impressão).
    const urlArtePorModelo = new Map<string, string>();
    try {
      const { data: modelosRows } = await client
        .from("pedidos_modelos")
        .select("id, url_arte")
        .eq("id_int", idInt);
      for (const row of modelosRows || []) {
        if (row.url_arte) {
          urlArtePorModelo.set(String(row.id), String(row.url_arte));
        }
      }
    } catch (e) {
      console.warn("[os-viewmodel] Falha ao buscar url_arte dos modelos (não-fatal):", e);
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

    const produtos: OsPdfProduto[] = (pedido.produtos || []).map((prod) => ({
      nome: prod.nome,
      quantidade: prod.quantidade,
      setor: prod.setor,
      modelos: (prod.modelos || []).map((m) => {
        const artes = [...(artesPorModelo.get(String(m.id)) || [])];
        const urlArte = urlArtePorModelo.get(String(m.id));
        if (urlArte) {
          const nome = urlArte.split("/").pop() || "arte";
          artes.unshift({ nomeArquivo: nome, mimeType: mimeFromNome(nome), publicUrl: urlArte });
        }
        return {
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

    // v1: variante administrativa não implementada — valores nunca são consultados.
    void opts.incluirValores;

    const vm: OsPdfViewModel = {
      idInt,
      os: {
        emissao: pedido.dataPedido,
        prazo: pedido.dataPrevistaEntrega || null,
        statusPedido: pedido.status_pedido || "",
        statusProducao: pedido.status_producao || "",
        statusInterno
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
