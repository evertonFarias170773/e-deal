import type { SupabaseClient } from "@supabase/supabase-js";
import { rotuloClienteComNumero } from "../lib/cliente-rotulo";
import { resolverIdDestinatarioEtiqueta } from "../lib/destinatario-etiqueta";

/**
 * Etiqueta da RETIRA NO BALCAO — o terceiro documento da Expedicao.
 *
 * POR QUE EXISTE
 *   A 10x15 de expedicao e um documento de ENVIO: endereco de entrega,
 *   transportadora, rastreio, peso e QR. Numa retirada nada disso existe — o
 *   modal de retirada nem pede endereco —, e a etiqueta acabava imprimindo um
 *   endereco vindo de fallback, para um volume que ninguem vai despachar.
 *
 *   Esta identifica um PACOTE NA PRATELEIRA: o numero que o cliente fala ao
 *   chegar, quem e ele, como cobra-lo e ha quanto tempo o pacote esta ali.
 *
 * O QUE NAO ENTRA, DE PROPOSITO
 *   Endereco, transportadora, rastreio, peso e QR Code. Nenhum tem uso no
 *   balcao, e cada um deles e uma chance de o atendente ler a informacao errada.
 *
 * MESMO PADRAO DOS OUTROS DOIS
 *   Viewmodel proprio, componente PDF proprio, rota propria — como
 *   `etiqueta-viewmodel.service` e `declaracao-viewmodel.service`. Nada foi
 *   extraido para base comum: os tres documentos respondem a perguntas
 *   diferentes e sao livres para divergir.
 */

/** Cliente cujos volumes saem com outro nome de remetente — mesma regra da 10x15. */
const CLIENTE_REMETENTE_ALTERNATIVO = 8469;
const NOME_REMETENTE_ALTERNATIVO = "DSEG BRASIL";

export type EtiquetaRetiradaViewModel = {
  idInt: number;
  /** Quantos volumes o pedido tem — uma pagina por volume, no padrao "n/total". */
  volumes: number;
  cliente: {
    /** "8469 - LISITON DOCUMENTOS SEGUROS LTDA", mesmo rotulo das outras etiquetas. */
    nome: string;
    telefone: string;
  };
  /**
   * Quando o pedido chegou na bancada da Expedicao (`expedicoes.data_pronto`),
   * ja formatada. Escolha do dono em 24/08/2026: e o instante em que o pacote
   * foi para a prateleira, e o unico que existe em pedido de retirada ainda nao
   * despachado — `data_despacho` so nasce quando o expedidor confirma.
   */
  prontoEm: string;
  /** Remetente em uma linha, igual ao rodape da 10x15. */
  remetenteRodape: string;
};

function fmtTelefone(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return String(bruto ?? "").trim();
}

/** dd/mm/aaaa às HH:MM em horário de São Paulo. Vazio quando não há data. */
function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (!Number.isFinite(d.getTime())) return "";
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
  return `${data} às ${hora}`;
}

function nomeRemetenteExibido(idCliente: number | null, nomeEmpresa: string): string {
  return idCliente === CLIENTE_REMETENTE_ALTERNATIVO ? NOME_REMETENTE_ALTERNATIVO : nomeEmpresa;
}

export async function montarEtiquetaRetiradaViewModel(
  supabase: SupabaseClient,
  idInt: number
): Promise<EtiquetaRetiradaViewModel | null> {
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, id_faturado, empresa")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const { data: exp } = await supabase
    .from("expedicoes")
    .select("qtd_volumes, data_pronto, id_cliente_destinatario_etiqueta")
    .eq("id_int", idInt)
    .maybeSingle();

  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;

  /**
   * Quem retira e quem comprou — e, havendo pagador distinto, quem o expedidor
   * escolheu no despacho. Mesma resolucao dos outros dois documentos, pela mesma
   * funcao: id que nao seja o cliente nem o pagador cai no cliente.
   */
  const idDestinatario = resolverIdDestinatarioEtiqueta(
    idCliente,
    proposta.id_faturado !== null && proposta.id_faturado !== undefined ? Number(proposta.id_faturado) : null,
    exp?.id_cliente_destinatario_etiqueta as number | null | undefined
  );

  const { data: cliente } = idDestinatario !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, whatsapp_1, telefone_fixo")
        .eq("id_cliente", idDestinatario)
        .maybeSingle()
    : { data: null };

  // Remetente do rodapé: empresa do pedido, casada por nome — mesma consulta da 10x15.
  const nomeEmpresa = String(proposta.empresa ?? "").trim();
  let empresaRow: { nome_fantasia: string | null; razao_social: string | null; municipio: string | null; uf: string | null } | null =
    null;
  if (nomeEmpresa) {
    const { data } = await supabase
      .from("empresas")
      .select("nome_fantasia, razao_social, municipio, uf, empresa")
      .or(`empresa.ilike."${nomeEmpresa}",nome_fantasia.ilike."${nomeEmpresa}",razao_social.ilike."${nomeEmpresa}"`)
      .limit(1);
    empresaRow = (data ?? [])[0] ?? null;
  }

  const volumes = Number(exp?.qtd_volumes ?? 0);

  return {
    idInt,
    volumes: Number.isFinite(volumes) && volumes > 0 ? volumes : 1,
    cliente: {
      // `proposta.cliente` e o nome do CLIENTE: so serve quando o destinatario e
      // ele. Escolhido o pagador, o nome vem do cadastro dele.
      nome: rotuloClienteComNumero(
        idDestinatario,
        idDestinatario === idCliente
          ? proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido #${idInt}`
          : cliente?.nome || cliente?.fantasia || `Cadastro ${idDestinatario}`
      ),
      telefone: fmtTelefone(cliente?.whatsapp_1 || cliente?.telefone_fixo)
    },
    prontoEm: fmtDataHora(exp?.data_pronto as string | null | undefined),
    remetenteRodape: [
      nomeRemetenteExibido(idCliente, empresaRow?.nome_fantasia || empresaRow?.razao_social || nomeEmpresa),
      [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join(" - ")
    ]
      .filter(Boolean)
      .join("  ·  ")
  };
}
