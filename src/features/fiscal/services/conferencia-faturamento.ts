import { getSupabaseClient } from "@/lib/supabase/client";
import { resolverEmpresaEmitente, ehEnderecoDeEntrega } from "@/features/nfe/services/nfe.service";

/**
 * Conferência do Faturar.
 *
 * POR QUE EXISTE
 *   Endereço, transporte e forma de pagamento são decididos no orçamento e
 *   conferidos na expedição. Quando estão errados, o certo é a nota não sair até
 *   o setor responsável corrigir na origem — não alguém consertar no fiscal.
 *   Esta checagem roda ANTES de criar o rascunho e, faltando dado, impede que a
 *   nota abra.
 *
 * O QUE ELA NÃO FAZ
 *   Não escreve nada. Não substitui a validação fiscal que roda na emissão: a de
 *   lá compara o cabeçalho com os filhos (totais, parcelas, pesos), coisas que
 *   só existem depois que o rascunho existe.
 */

export type SetorResponsavel = "Comercial" | "Financeiro" | "Fiscal";

export interface PendenciaFaturamento {
  codigo: string;
  /** O que está errado, em uma frase. */
  titulo: string;
  /** O valor realmente encontrado, para não obrigar o operador a caçar. */
  encontrado: string;
  setor: SetorResponsavel;
  /** Onde se corrige, em linguagem de tela. */
  onde: string;
  /** Rota interna para o botão levar direto ao lugar. Ausente quando não há. */
  rota?: string;
}

export interface ResultadoConferencia {
  ok: boolean;
  bloqueios: PendenciaFaturamento[];
  avisos: PendenciaFaturamento[];
}

const CEP_VALIDO = /^[0-9]{5}-?[0-9]{3}$/;

/** `1 = Contribuinte ICMS`, `ISENTO`, vazio — a base guarda o rótulo, não o código. */
function ehContribuinteIcms(tipoContribuinte: string | null | undefined): boolean {
  const texto = String(tipoContribuinte ?? "").toUpperCase();
  if (!texto) return false;
  if (texto.includes("NAO") || texto.includes("NÃO")) return false;
  return texto.includes("CONTRIBUINTE ICMS");
}

function apenasDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function vazio(valor: string | null | undefined): boolean {
  return String(valor ?? "").trim() === "";
}

export async function conferirFaturamento(idInt: number): Promise<ResultadoConferencia> {
  const bloqueios: PendenciaFaturamento[] = [];
  const avisos: PendenciaFaturamento[] = [];

  const client = getSupabaseClient();
  if (!client) {
    bloqueios.push({
      codigo: "SEM_CONEXAO",
      titulo: "Não foi possível consultar o banco de dados.",
      encontrado: "conexão indisponível",
      setor: "Fiscal",
      onde: "Tente novamente em alguns instantes."
    });
    return { ok: false, bloqueios, avisos };
  }

  const rotaProposta = `/orcamentos/${idInt}`;

  const { data: propostaRow, error: propostaError } = await client
    .from("propostas")
    .select(
      "id_int,id_cliente,cliente,empresa,id_endereco_ent,valor,valor_total,valor_frete,modalidade_frete"
    )
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError || !propostaRow) {
    bloqueios.push({
      codigo: "PROPOSTA_NAO_ENCONTRADA",
      titulo: "Pedido não encontrado.",
      encontrado: `#${idInt}`,
      setor: "Comercial",
      onde: "Orçamentos"
    });
    return { ok: false, bloqueios, avisos };
  }

  const proposta = propostaRow as {
    id_cliente: number | null;
    cliente: string | null;
    empresa: string | null;
    id_endereco_ent: string | null;
    valor: number | null;
    valor_total: number | null;
    valor_frete: number | null;
    modalidade_frete: string | null;
  };

  // ---------------------------------------------------------------------------
  // Cliente e documento
  // ---------------------------------------------------------------------------
  let documento = "";
  let ehContribuinte = false;

  if (!proposta.id_cliente) {
    bloqueios.push({
      codigo: "CLIENTE_SEM_CADASTRO",
      titulo: "O pedido não tem cliente cadastrado.",
      encontrado: proposta.cliente || "sem cliente",
      setor: "Comercial",
      onde: "Cadastro do cliente — a nota precisa de um destinatário com CPF ou CNPJ.",
      rota: rotaProposta
    });
  } else {
    const { data: clienteRow } = await client
      .from("clientes")
      .select("nome,documento,ins_estadual,tipo_contribuinte")
      .eq("id_cliente", proposta.id_cliente)
      .maybeSingle();

    const cliente = clienteRow as {
      nome: string | null;
      documento: string | null;
      ins_estadual: string | null;
      tipo_contribuinte: string | null;
    } | null;

    if (!cliente) {
      bloqueios.push({
        codigo: "CLIENTE_SEM_CADASTRO",
        titulo: "O cliente do pedido não existe mais no cadastro.",
        encontrado: `id ${proposta.id_cliente}`,
        setor: "Comercial",
        onde: "Cadastros → Clientes",
        rota: "/cadastros"
      });
    } else {
      documento = apenasDigitos(cliente.documento);
      ehContribuinte = ehContribuinteIcms(cliente.tipo_contribuinte);
      const rotaCliente = `/cadastros/${proposta.id_cliente}`;

      if (documento.length !== 11 && documento.length !== 14) {
        bloqueios.push({
          codigo: "DOCUMENTO_INVALIDO",
          titulo: "CPF ou CNPJ do cliente é inválido.",
          encontrado: cliente.documento?.trim() || "vazio",
          setor: "Comercial",
          onde: "Cadastro do cliente → Dados principais",
          rota: rotaCliente
        });
      } else if (documento.length === 14 && ehContribuinte && vazio(cliente.ins_estadual)) {
        bloqueios.push({
          codigo: "CNPJ_CONTRIBUINTE_SEM_IE",
          titulo: "Cliente CNPJ marcado como contribuinte de ICMS e sem Inscrição Estadual.",
          encontrado: "IE vazia",
          setor: "Comercial",
          onde: "Cadastro do cliente → Dados fiscais. Informe a IE ou marque como isento.",
          rota: rotaCliente
        });
      } else if (documento.length === 11 && ehContribuinte) {
        bloqueios.push({
          codigo: "CPF_CONTRIBUINTE_INCOERENTE",
          titulo: "Cliente pessoa física marcado como contribuinte de ICMS.",
          encontrado: cliente.tipo_contribuinte || "",
          setor: "Comercial",
          onde: "Cadastro do cliente → Dados fiscais. CPF deve ser não contribuinte.",
          rota: rotaCliente
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Endereço
  // ---------------------------------------------------------------------------
  const idEndereco = String(proposta.id_endereco_ent ?? "").trim();
  const rotaCliente = proposta.id_cliente ? `/cadastros/${proposta.id_cliente}` : undefined;

  if (!idEndereco) {
    bloqueios.push({
      codigo: "ENDERECO_NAO_APONTADO",
      titulo: "O pedido não aponta para nenhum endereço.",
      encontrado: "sem endereço escolhido",
      setor: "Comercial",
      onde: "Orçamento → Endereço de entrega. Escolha o endereço do pedido.",
      rota: rotaProposta
    });
  } else {
    const { data: enderecoRow } = await client
      .from("enderecos")
      .select("tipo_endereco,cep,endereco,numero,bairro,cidade,uf")
      .eq("id", idEndereco)
      .maybeSingle();

    const endereco = enderecoRow as {
      tipo_endereco: string | null;
      cep: string | null;
      endereco: string | null;
      numero: string | null;
      bairro: string | null;
      cidade: string | null;
      uf: string | null;
    } | null;

    if (!endereco) {
      bloqueios.push({
        codigo: "ENDERECO_INEXISTENTE",
        titulo: "O endereço escolhido no pedido não existe mais.",
        encontrado: idEndereco,
        setor: "Comercial",
        onde: "Orçamento → Endereço de entrega. Escolha outro endereço.",
        rota: rotaProposta
      });
    } else {
      const faltando = (
        [
          ["logradouro", endereco.endereco],
          ["número", endereco.numero],
          ["bairro", endereco.bairro],
          ["cidade", endereco.cidade],
          ["UF", endereco.uf],
          ["CEP", endereco.cep]
        ] as Array<[string, string | null]>
      )
        .filter(([, valor]) => vazio(valor))
        .map(([nome]) => nome);

      const destino = ehEnderecoDeEntrega(endereco.tipo_endereco) ? "de entrega" : "principal";

      if (faltando.length > 0) {
        bloqueios.push({
          codigo: "ENDERECO_INCOMPLETO",
          titulo: `Endereço ${destino} incompleto: falta ${faltando.join(", ")}.`,
          encontrado: `${endereco.cidade || "?"}/${endereco.uf || "?"}`,
          setor: "Comercial",
          onde: "Cadastro do cliente → Endereços",
          rota: rotaCliente
        });
      } else if (!CEP_VALIDO.test(String(endereco.cep).trim())) {
        bloqueios.push({
          codigo: "CEP_INVALIDO",
          titulo: `CEP do endereço ${destino} está fora do formato.`,
          encontrado: String(endereco.cep).trim(),
          setor: "Comercial",
          onde: `Cadastro do cliente → Endereços → ${endereco.cidade || ""}/${endereco.uf || ""}`,
          rota: rotaCliente
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Itens
  // ---------------------------------------------------------------------------
  const { data: itensRows } = await client
    .from("produtos_proposta")
    .select("id,nome_produto,ncm,id_produto")
    .eq("id_int", idInt);

  const itens = (itensRows ?? []) as Array<{
    nome_produto: string | null;
    ncm: string | null;
    id_produto: number | null;
  }>;

  if (itens.length === 0) {
    bloqueios.push({
      codigo: "SEM_ITENS",
      titulo: "O pedido não tem nenhum item.",
      encontrado: "0 itens",
      setor: "Comercial",
      onde: "Orçamento → Produtos",
      rota: rotaProposta
    });
  } else {
    const semNcm = itens.filter((item) => !/^[0-9]{8}$/.test(apenasDigitos(item.ncm)));
    if (semNcm.length > 0) {
      bloqueios.push({
        codigo: "ITEM_SEM_NCM",
        titulo: `${semNcm.length} ${semNcm.length === 1 ? "item está" : "itens estão"} sem NCM de 8 dígitos.`,
        encontrado: semNcm
          .slice(0, 3)
          .map((item) => `${item.nome_produto || "item"}: ${item.ncm?.trim() || "vazio"}`)
          .join(" · "),
        setor: "Comercial",
        onde: "Cadastro do produto → Dados fiscais → NCM",
        rota: "/produtos"
      });
    }

    const semProduto = itens.filter((item) => !item.id_produto);
    if (semProduto.length > 0) {
      bloqueios.push({
        codigo: "ITEM_SEM_PRODUTO",
        titulo: `${semProduto.length} ${semProduto.length === 1 ? "item não está" : "itens não estão"} ligados a produto cadastrado.`,
        encontrado: semProduto
          .slice(0, 3)
          .map((item) => item.nome_produto || "sem nome")
          .join(" · "),
        setor: "Comercial",
        onde: "Orçamento → Produtos",
        rota: rotaProposta
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Valor
  // ---------------------------------------------------------------------------
  const valorTotal = Number(proposta.valor_total ?? proposta.valor ?? 0);
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    bloqueios.push({
      codigo: "VALOR_INVALIDO",
      titulo: "O valor total do pedido não é maior que zero.",
      encontrado: String(proposta.valor_total ?? proposta.valor ?? "vazio"),
      setor: "Comercial",
      onde: "Orçamento → Resumo",
      rota: rotaProposta
    });
  }

  // ---------------------------------------------------------------------------
  // Cobrança
  // ---------------------------------------------------------------------------
  const { data: cobrancaRow } = await client
    .from("pagamentos_v2")
    .select("tipo_cobranca,created_at")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tipoCobranca = String(
    (cobrancaRow as { tipo_cobranca?: string } | null)?.tipo_cobranca ?? ""
  ).trim();

  if (!tipoCobranca) {
    bloqueios.push({
      codigo: "COBRANCA_NAO_IDENTIFICADA",
      titulo: "O pedido não tem cobrança registrada — a nota não sabe a forma de pagamento.",
      encontrado: "nenhuma cobrança",
      setor: "Financeiro",
      onde: "Orçamento → Pagamentos",
      rota: rotaProposta
    });
  }

  // ---------------------------------------------------------------------------
  // Empresa emitente
  // ---------------------------------------------------------------------------
  const idEmpresa = resolverEmpresaEmitente(proposta.empresa);
  const { data: empresaRow } = await client
    .from("empresas")
    .select("empresa,habilita_nfe")
    .eq("id", idEmpresa)
    .maybeSingle();

  const empresa = empresaRow as { empresa: string | null; habilita_nfe: boolean | null } | null;

  if (!empresa) {
    bloqueios.push({
      codigo: "EMPRESA_NAO_RESOLVIDA",
      titulo: "Não foi possível identificar a empresa emitente do pedido.",
      encontrado: proposta.empresa || "vazio",
      setor: "Fiscal",
      onde: "Configurações → Empresas"
    });
  } else if (empresa.habilita_nfe !== true) {
    bloqueios.push({
      codigo: "EMPRESA_SEM_NFE",
      titulo: `A empresa ${empresa.empresa || idEmpresa} não está habilitada para emitir NF-e.`,
      encontrado: "habilita_nfe desligado",
      setor: "Fiscal",
      onde: "Configurações → Empresas → Dados fiscais"
    });
  }

  // ---------------------------------------------------------------------------
  // Avisos — não impedem
  // ---------------------------------------------------------------------------
  const valorFrete = Number(proposta.valor_frete ?? 0);
  if (valorFrete > 0 && vazio(proposta.modalidade_frete)) {
    avisos.push({
      codigo: "FRETE_SEM_MODALIDADE",
      titulo: "O pedido tem frete cobrado, mas não diz de quem é a responsabilidade.",
      encontrado: `frete R$ ${valorFrete.toFixed(2)}, modalidade vazia`,
      setor: "Comercial",
      onde: "Orçamento → Frete. Sem isso, a nota assume CIF.",
      rota: rotaProposta
    });
  }

  const { data: notasRows } = await client
    .from("notas_fiscais")
    .select("ref,status")
    .eq("id_int", idInt);

  const notasVivas = ((notasRows ?? []) as Array<{ ref: string; status: string | null }>).filter(
    (nota) => !["CANCELADA", "DENEGADA"].includes(String(nota.status ?? "").toUpperCase())
  );

  if (notasVivas.length > 0) {
    avisos.push({
      codigo: "JA_TEM_NOTA",
      titulo: `Este pedido já tem ${notasVivas.length} nota${notasVivas.length > 1 ? "s" : ""}.`,
      encontrado: notasVivas.map((nota) => `${nota.ref} (${nota.status})`).join(" · "),
      setor: "Fiscal",
      onde: "Faturar de novo cria uma nota adicional. É o caminho do faturamento parcial."
    });
  }

  return { ok: bloqueios.length === 0, bloqueios, avisos };
}
