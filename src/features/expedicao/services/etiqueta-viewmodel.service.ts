import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverPesoExpedicao } from "../lib/peso";
import { rotuloClienteComNumero } from "../lib/cliente-rotulo";

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

export async function montarEtiquetaViewModel(
  supabase: SupabaseClient,
  idInt: number
): Promise<EtiquetaViewModel | null> {
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, empresa, cep")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const [{ data: exp }, { data: os }, { data: frete }, { data: notas }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, peso_bruto_kg, qtd_volumes, tipo_volume, transportadora_nome, codigo_rastreamento, id_endereco_entrega, obs, data_despacho")
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
    supabase.from("notas_fiscais").select("numero_nf, status").eq("id_int", idInt)
  ]);

  // NF: só a AUTORIZADA vai para a etiqueta. Nota pendente ou cancelada impressa
  // no volume induziria a conferência a erro.
  const nfAutorizada = (notas ?? []).find((n) => String(n.status ?? "").toUpperCase() === "AUTORIZADA");

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

  if (expConfirmado?.id_endereco_entrega) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, recebedor")
      .eq("id", expConfirmado.id_endereco_entrega)
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

  const { data: cliente } = idCliente !== null
    ? await supabase
        .from("clientes")
        .select("nome, fantasia, documento, whatsapp_1, telefone_fixo, cidade_uf")
        .eq("id_cliente", idCliente)
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
    transportadora: expConfirmado?.transportadora_nome || frete?.servico || "",
    codigoRastreamento: expConfirmado?.codigo_rastreamento || os?.codigo_rastreamento || "",
    obs: expConfirmado?.obs || "",
    nfNumero: nfAutorizada?.numero_nf ? String(nfAutorizada.numero_nf) : "",
    tipoVolume: exp?.tipo_volume || "",
    remetenteRodape: [
      empresaRow?.nome_fantasia || empresaRow?.razao_social || nomeEmpresa,
      [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join(" - ")
    ]
      .filter(Boolean)
      .join("  ·  "),
    destinatario: {
      // Mesmo rótulo da lista da Expedição: número do cadastro antes do nome.
      // Sem `id_cliente` na proposta, sai só o nome (nada de prefixo vazio).
      nome: rotuloClienteComNumero(
        idCliente,
        proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido #${idInt}`
      ),
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
