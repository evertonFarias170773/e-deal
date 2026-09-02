import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEmpresaRemetente } from "@/lib/correios/empresa-remetente";
import { resolverPesoExpedicao } from "../lib/peso";
import { idDestinatarioEtiquetaVigente } from "../lib/destinatario-etiqueta";
import { idEnderecoEntregaVigente } from "../lib/endereco-entrega";

export type ItemDeclaracao = {
  discriminacao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type ParteDeclaracao = {
  nome: string;
  documento: string;
  endereco: string;
  bairro: string;
  cidadeUf: string;
  cep: string;
};

export type DeclaracaoViewModel = {
  idInt: number;
  remetente: ParteDeclaracao;
  destinatario: ParteDeclaracao;
  itens: ItemDeclaracao[];
  totalValor: number;
  totalQuantidade: number;
  pesoKg: string;
  cidadeEmissao: string;
};

/** 14 dígitos vira CNPJ, 11 vira CPF; qualquer outra coisa sai como veio. */
function formatarDocumento(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return String(bruto ?? "").trim();
}

function formatarCep(bruto: string | null | undefined): string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, "$1-$2") : String(bruto ?? "").trim();
}

/**
 * Declaração de conteúdo — documento que acompanha a remessa quando NÃO há NF-e
 * autorizada. Os Correios registram os itens via `itensDeclaracaoConteudo` na
 * pré-postagem, mas o rótulo que eles devolvem é só a etiqueta (conferido: PDF
 * de 1 página). O papel a colar no volume é este, gerado aqui.
 *
 * Reaproveita `resolverEmpresaRemetente` — a mesma função que escolhe as
 * credenciais dos Correios — para o remetente sair coerente com quem postou.
 */
export async function montarDeclaracaoViewModel(
  supabase: SupabaseClient,
  idInt: number
): Promise<DeclaracaoViewModel | null> {
  const { data: proposta } = await supabase
    .from("propostas")
    .select("id_int, cliente, id_cliente, id_faturado, empresa, cep, id_endereco_ent")
    .eq("id_int", idInt)
    .maybeSingle();
  if (!proposta) return null;

  const [{ data: exp }, { data: frete }, { data: itensPedido }] = await Promise.all([
    supabase
      .from("expedicoes")
      .select("peso_kg, peso_bruto_kg, id_endereco_entrega, id_cliente_destinatario_etiqueta, data_despacho")
      .eq("id_int", idInt)
      .maybeSingle(),
    supabase
      .from("cotacao_frete")
      .select("peso, cep")
      .eq("id_int", idInt)
      .eq("escolhido", true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("produtos_proposta")
      .select("nome_produto, modelo_descri, qtd, valor_unt, valor_sub_total")
      .eq("id_int", idInt)
  ]);

  // Endereço de entrega: o escolhido no despacho > o que casa com o CEP cotado >
  // o mais recente. Mesma escada de etiqueta-viewmodel.service.ts.
  const idCliente = proposta.id_cliente !== null ? Number(proposta.id_cliente) : null;
  let endereco: {
    endereco: string | null; numero: string | null; complemento: string | null;
    bairro: string | null; cidade: string | null; uf: string | null; cep: string | null;
  } | null = null;

  // Mesmo criterio da etiqueta: o destino sai do estado CONFIRMADO, nunca de
  // rascunho. O peso segue a precedencia unica, que considera o rascunho.

  /**
   * PRECEDÊNCIA ÚNICA DO ENDEREÇO (02/09/2026) — `lib/endereco-entrega.ts`.
   *
   * Substitui a regra de 24/08/2026, que lia `exp.id_endereco_entrega` fora do
   * gate de `data_despacho` para não descartar a escolha do expedidor (casos
   * 21000 e 21055). Aquela escolha manual não existe mais desde `aafc0a6`: o
   * endereço vem da proposta. O que sobrou daquela regra — não descartar o
   * endereço gravado — segue valendo, agora com despacho confirmado vencendo.
   *
   * Sem esta correção a Declaração imprimia o MAIS RECENTE DO CLIENTE quando
   * não havia nada gravado, divergindo do que o modal exibia. O palpite abaixo
   * continua, mas só depois do endereço da proposta.
   */
  const idEnderecoVigente = idEnderecoEntregaVigente({
    despachoConfirmado: Boolean(exp?.data_despacho),
    idGravadoNoDespacho: exp?.id_endereco_entrega as string | null | undefined,
    idDefinidoNaProposta: proposta.id_endereco_ent as string | null | undefined
  });
  if (idEnderecoVigente) {
    const { data } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id", idEnderecoVigente)
      .maybeSingle();
    endereco = data ?? null;
  }
  if (!endereco && idCliente !== null) {
    const { data: lista } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep, data_criacao")
      .eq("id_cliente", idCliente)
      .order("data_criacao", { ascending: false });
    const cepAlvo = String(frete?.cep ?? proposta.cep ?? "").replace(/\D/g, "");
    endereco =
      (cepAlvo && (lista ?? []).find((e) => String(e.cep ?? "").replace(/\D/g, "") === cepAlvo)) ||
      (lista ?? [])[0] ||
      null;
  }

  /**
   * EM NOME DE QUEM A DECLARACAO SAI (24/08/2026).
   *
   * A etiqueta 10x15 e a prepostagem ja respeitavam a escolha do despacho; esta
   * ficou para tras e imprimia o cliente da proposta no MESMO volume em que a
   * etiqueta trazia o pagador. Mesma funcao das outras duas, sem regra propria:
   * id que nao seja o cliente nem o pagador cai no cliente, e coluna nula
   * mantem o comportamento de sempre.
   *
   * Nao ha consulta nova: e o mesmo `SELECT` de `clientes` que ja existia, agora
   * pelo id resolvido, mais dois campos acrescentados a `SELECT`s existentes.
   * O REMETENTE nao e tocado — continua saindo de `resolverEmpresaRemetente`.
   */
  const idDestinatario = idDestinatarioEtiquetaVigente({
    despachoConfirmado: Boolean(exp?.data_despacho),
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
        .select("nome, fantasia, documento, cidade_uf")
        .eq("id_cliente", idDestinatario)
        .maybeSingle()
    : { data: null };

  const empresaRow = await resolverEmpresaRemetente(supabase, proposta.empresa);

  const itens: ItemDeclaracao[] = (itensPedido ?? [])
    .map((item) => {
      const nome = String(item.nome_produto ?? item.modelo_descri ?? "").trim();
      if (!nome) return null;
      const quantidade = Math.max(1, Number(item.qtd) || 1);
      const subtotal = Number(item.valor_sub_total) || 0;
      const unitario = Number(item.valor_unt) || (quantidade > 0 ? subtotal / quantidade : 0);
      return {
        discriminacao: nome,
        quantidade,
        valorUnitario: Number.isFinite(unitario) ? unitario : 0,
        valorTotal: subtotal || (Number.isFinite(unitario) ? unitario * quantidade : 0)
      };
    })
    .filter((i): i is ItemDeclaracao => i !== null);

  // Precedência única (lib/peso.ts): aferido > bruto da revisão > cotado.
  const { pesoKg: pesoNumero } = resolverPesoExpedicao({
    pesoAferidoKg: exp?.peso_kg,
    pesoBrutoKg: exp?.peso_bruto_kg,
    pesoCotadoGramas: frete?.peso
  });

  return {
    idInt,
    remetente: {
      nome: empresaRow?.razao_social || empresaRow?.nome_fantasia || String(proposta.empresa ?? ""),
      documento: formatarDocumento(empresaRow?.cnpj),
      endereco: [
        [empresaRow?.logradouro, empresaRow?.numero].filter(Boolean).join(", "),
        empresaRow?.complemento
      ]
        .filter(Boolean)
        .join(" - "),
      bairro: empresaRow?.bairro ?? "",
      cidadeUf: [empresaRow?.municipio, empresaRow?.uf].filter(Boolean).join("/"),
      cep: formatarCep(empresaRow?.cep)
    },
    destinatario: {
      // `proposta.cliente` e o nome do CLIENTE: so serve quando o destinatario e
      // ele. Nome e documento saem do mesmo cadastro — separa-los declararia uma
      // pessoa que nao existe.
      nome: String(
        idDestinatario === idCliente
          ? proposta.cliente || cliente?.nome || cliente?.fantasia || `Pedido #${idInt}`
          : cliente?.nome || cliente?.fantasia || `Cadastro ${idDestinatario}`
      ),
      documento: formatarDocumento(cliente?.documento),
      endereco: endereco
        ? [[endereco.endereco, endereco.numero].filter(Boolean).join(", "), endereco.complemento]
            .filter(Boolean)
            .join(" - ")
        : "",
      bairro: endereco?.bairro ?? "",
      cidadeUf: endereco ? [endereco.cidade, endereco.uf].filter(Boolean).join("/") : (cliente?.cidade_uf ?? ""),
      cep: formatarCep(endereco?.cep)
    },
    itens,
    totalValor: itens.reduce((s, i) => s + i.valorTotal, 0),
    totalQuantidade: itens.reduce((s, i) => s + i.quantidade, 0),
    pesoKg:
      pesoNumero && pesoNumero > 0
        ? pesoNumero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "",
    // Local de emissão = cidade do remetente, que é quem assina.
    cidadeEmissao: empresaRow?.municipio ?? ""
  };
}
