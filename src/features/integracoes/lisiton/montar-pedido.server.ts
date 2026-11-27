import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import { EMPRESAS_RECEBEDORAS_FIXAS } from "@/features/cobrancas/cobrancas-utils";
import { mapSupabaseProdutoRowToProduto } from "@/features/produtos/mappers";
import type { SupabaseProdutoRow } from "@/features/produtos/types.supabase";
import { buildPropostaInformalText, calculateResumo, createItemFromProduto } from "@/features/orcamentos/orcamento-utils";
import { montarDadosItemProposta, montarInsertDeLoteDaProposta } from "@/features/orcamentos/services/orcamentos.service";
import { checklistVisivel } from "@/features/orcamentos/lib/checklist-lote";
import { nomeTransportadoraCadastro, nomeTransporteEfetivo } from "@/features/orcamentos/lib/modalidade-frete";
import { categoriaDoServico, categoriaPorNomeConhecido } from "@/features/orcamentos/lib/categoria-frete";
import { categoriaDerivadaDaEscolha } from "@/features/orcamentos/lib/transporte-categoria";
import { mesmoTelefone } from "@/features/orcamentos/lib/conversa-whatsapp";
import { conversasDoCliente } from "@/features/orcamentos/services/contatos-do-pedido.server";
import type { PropostaItem } from "@/features/orcamentos/types";
import { ID_CLIENTE_LISITON, produtoLisiton, resolverCor, type ProdutoLisiton } from "./catalogo";

/**
 * INTEGRAÇÃO LISITON → VIBE: monta o pedido com as MESMAS funções do Salvar da
 * tela (27/11/2026). Só lê do banco. Quem grava é `lisiton_criar_pedido`, numa
 * transação (migration 20261127_lisiton_api_criar_pedido).
 *
 *   item  = createItemFromProduto(produto do cadastro) -> montarDadosItemProposta
 *           (preço `valorUnt` e fixo `valorFixo` do produto, sem bônus: a 8469 não tem)
 *   lote  = montarInsertDeLoteDaProposta, com o checklist do produto (um por cor)
 *   frete = FOB, zero; nome e categorias por nomeTransporteEfetivo,
 *           nomeTransportadoraCadastro, categoriaDoServico/categoriaPorNomeConhecido
 *           e categoriaDerivadaDaEscolha, como o Salvar
 *   texto = buildPropostaInformalText, total = calculateResumo
 *   contatos = todas as conversas da 8469 no Guru; principal = a da configuração
 *           (Lisiane); id_contato pela mesma ponte do telefone (mesmoTelefone)
 */

/** Vendedora dos pedidos da Lisiton (decisão do Everton, 26/11/2026): Lisiane Colbeich. */
export const UID_VENDEDORA_LISITON = "eabb8c8d-eed0-4aad-a829-f50873bdcae0";

export type CorpoPedidoLisiton = {
  chave_idempotencia?: unknown;
  cliente?: { documento?: unknown; nome?: unknown; email?: unknown; telefone?: unknown };
  endereco?: {
    cep?: unknown;
    logradouro?: unknown;
    numero?: unknown;
    complemento?: unknown;
    bairro?: unknown;
    cidade?: unknown;
    uf?: unknown;
  };
  /** CNPJ da transportadora, OU codigo "MELHOR_ENVIO" (a Lisiton não tem o CNPJ dele). Nunca os dois. */
  transportadora?: { cnpj?: unknown; codigo?: unknown };
  itens?: Array<{ produto?: unknown; cores?: Array<{ cor?: unknown; quantidade?: unknown }> }>;
  observacao?: unknown;
};

export type Recusa = { ok: false; status: number; erro: string; mensagem: string };
export type PedidoMontado = { ok: true; chave: string; payload: Record<string, unknown> };

const txt = (v: unknown, max = 200): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const digitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const recusa = (mensagem: string, erro = "dados_invalidos", status = 422): Recusa => ({ ok: false, status, erro, mensagem });

/** 27/11/2026: a Lisiton não tem o CNPJ do Melhor Envio; manda este código e o Vibe usa a 70010. */
export const CODIGO_MELHOR_ENVIO = "MELHOR_ENVIO";
export const ID_TRANSPORTADORA_MELHOR_ENVIO = 70010;
const temCodigoMelhorEnvio = (corpo: CorpoPedidoLisiton): boolean => txt(corpo.transportadora?.codigo) === CODIGO_MELHOR_ENVIO;

/** Hash do conteúdo, sem a chave: a mesma chave com outro conteúdo é recusada pelo banco. */
export function hashDoPedido(corpo: CorpoPedidoLisiton): string {
  const { chave_idempotencia: _chave, ...resto } = corpo;
  void _chave;
  const ordenar = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordenar)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
        : v;
  return createHash("sha256").update(JSON.stringify(ordenar(resto))).digest("hex");
}

type ItemValidado = { produto: ProdutoLisiton; lotes: Array<{ cor: string; quantidade: number }>; quantidade: number };

/** Confere o corpo e devolve os itens já com as cores no nome exato do Vibe. */
export function validarCorpo(corpo: CorpoPedidoLisiton): { ok: true; itens: ItemValidado[]; chave: string } | Recusa {
  const chave = txt(corpo.chave_idempotencia, 200);
  if (chave.length < 8 || chave.length > 100) return recusa("chave_idempotencia é obrigatória (8 a 100 caracteres).", "chave_invalida", 400);

  const doc = digitos(corpo.cliente?.documento);
  const tipo = doc.length === 14 ? "CNPJ" : doc.length === 11 ? "CPF" : null;
  if (!tipo) return recusa("cliente.documento precisa ser um CPF (11 dígitos) ou CNPJ (14 dígitos).");
  const docOk = validateDocumentByTipo(doc, tipo);
  if (!docOk.isValid) return recusa(`cliente.documento inválido: ${docOk.message}`);
  if (txt(corpo.cliente?.nome).length < 2) return recusa("cliente.nome é obrigatório.");

  const e = corpo.endereco ?? {};
  if (digitos(e.cep).length !== 8) return recusa("endereco.cep precisa ter 8 dígitos.");
  for (const [campo, valor] of [["logradouro", e.logradouro], ["numero", e.numero], ["bairro", e.bairro], ["cidade", e.cidade]] as const) {
    if (!txt(valor)) return recusa(`endereco.${campo} é obrigatório.`);
  }
  if (!/^[A-Za-z]{2}$/.test(txt(e.uf))) return recusa("endereco.uf precisa ter 2 letras.");
  const temCnpj = txt(corpo.transportadora?.cnpj) !== "";
  const temCodigo = txt(corpo.transportadora?.codigo) !== "";
  if (temCnpj === temCodigo) {
    return recusa(
      'Informe a transportadora que vai retirar com transportadora.cnpj (14 dígitos) OU transportadora.codigo = "MELHOR_ENVIO", nunca os dois.'
    );
  }
  if (temCnpj && digitos(corpo.transportadora?.cnpj).length !== 14) return recusa("transportadora.cnpj precisa ter 14 dígitos.");
  if (temCodigo && txt(corpo.transportadora?.codigo) !== CODIGO_MELHOR_ENVIO) {
    return recusa('transportadora.codigo só aceita "MELHOR_ENVIO"; para as outras transportadoras, envie transportadora.cnpj.');
  }

  if (!Array.isArray(corpo.itens) || corpo.itens.length === 0) return recusa("itens precisa ter pelo menos um produto.");
  const vistos = new Set<number>();
  const itens: ItemValidado[] = [];
  for (const bruto of corpo.itens) {
    const produto = produtoLisiton(bruto?.produto);
    if (!produto) return recusa(`Produto ${txt(bruto?.produto) || "(vazio)"} não aceito. Aceitos: 9000, 9002, 9003, 9004, 201 e 202.`, "produto_nao_aceito");
    if (vistos.has(produto.id)) return recusa(`O produto ${produto.id} aparece mais de uma vez: mande as cores dele num item só.`);
    vistos.add(produto.id);
    if (!Array.isArray(bruto.cores) || bruto.cores.length === 0) return recusa(`Informe as cores do produto ${produto.id} (${produto.nome}).`);
    const lotes: ItemValidado["lotes"] = [];
    for (const c of bruto.cores) {
      const cor = resolverCor(produto, c?.cor);
      if (!cor.ok) return recusa(cor.mensagem, "cor_nao_aceita");
      if (lotes.some((l) => l.cor === cor.cor)) return recusa(`A cor ${cor.cor} aparece mais de uma vez no produto ${produto.id}.`);
      const quantidade = Number(c?.quantidade);
      if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 100000) {
        return recusa(`Quantidade inválida para ${produto.nome} ${cor.cor}: precisa ser um inteiro maior que zero.`);
      }
      lotes.push({ cor: cor.cor, quantidade });
    }
    itens.push({ produto, lotes, quantidade: lotes.reduce((s, l) => s + l.quantidade, 0) });
  }
  return { ok: true, itens, chave };
}

/** Lê o que falta no banco e monta o payload de `lisiton_criar_pedido`. */
export async function montarPedidoLisiton(service: SupabaseClient, corpo: CorpoPedidoLisiton): Promise<PedidoMontado | Recusa> {
  const validado = validarCorpo(corpo);
  if (!validado.ok) return validado;
  const ids = validado.itens.map((i) => i.produto.id);

  const [cfgRes, lisitonRes, vendedoraRes, produtosRes, camposRes, transpRes, contatosRes] = await Promise.all([
    service.from("integracao_lisiton_config").select("id_empresa, chat_id_principal").eq("id", true).maybeSingle(),
    service.from("clientes").select("id_cliente, nome").eq("id_cliente", ID_CLIENTE_LISITON).maybeSingle(),
    service.from("usuarios").select("user_id, nome_usuario, meu_vendedor, id_vendedor").eq("user_id", UID_VENDEDORA_LISITON).maybeSingle(),
    service.from("produtos").select("*").in("id_produto", ids),
    service.from("produto_boletim_campos").select("id_produto, campo").in("id_produto", ids),
    txt(corpo.transportadora?.codigo) === CODIGO_MELHOR_ENVIO
      ? Promise.resolve({ data: [{ id_cliente: ID_TRANSPORTADORA_MELHOR_ENVIO }], error: null })
      : service
          .from("vw_cadastros_lista_completa")
          .select("id_cliente")
          .eq("documento_numeros", digitos(corpo.transportadora?.cnpj))
          .order("id_cliente", { ascending: true }),
    service.from("contatos").select("id, nome_contato, whats, ativo").eq("id_cliente", ID_CLIENTE_LISITON)
  ]);
  for (const r of [cfgRes, lisitonRes, vendedoraRes, produtosRes, camposRes, transpRes, contatosRes]) {
    if (r.error) return recusa(`Falha ao ler o cadastro: ${r.error.message}`, "erro_interno", 500);
  }
  const cfg = cfgRes.data as { id_empresa: number; chat_id_principal: string } | null;
  const empresa = EMPRESAS_RECEBEDORAS_FIXAS.find((e) => e.id === Number(cfg?.id_empresa));
  if (!cfg || !empresa) return recusa("Configuração da integração ausente.", "erro_interno", 500);
  const vendedora = vendedoraRes.data as { user_id: string; nome_usuario: string | null; meu_vendedor: string | null; id_vendedor: string | null } | null;
  if (!vendedora) return recusa("Vendedora da integração não encontrada.", "erro_interno", 500);
  const nomeVendedora = txt(vendedora.meu_vendedor) || txt(vendedora.nome_usuario);

  // Transportadora: cadastro de transportadora ativo com o CNPJ enviado (ou a 70010, pelo código MELHOR_ENVIO).
  const idsTransp = ((transpRes.data ?? []) as Array<{ id_cliente: number }>).map((t) => Number(t.id_cliente));
  const { data: transportadoras, error: errT } = idsTransp.length
    ? await service.from("clientes").select("id_cliente, nome, fantasia, categoria, ativo").in("id_cliente", idsTransp)
    : { data: [], error: null };
  if (errT) return recusa(`Falha ao ler a transportadora: ${errT.message}`, "erro_interno", 500);
  const transportadora = ((transportadoras ?? []) as Array<{ id_cliente: number; nome: string | null; fantasia: string | null; categoria: string | null; ativo: boolean | null }>)
    .filter((t) => String(t.categoria ?? "").toUpperCase() === "TRANSPORTADORA" && t.ativo === true)
    .sort((a, b) => a.id_cliente - b.id_cliente)[0];
  if (!transportadora) {
    return recusa(
      temCodigoMelhorEnvio(corpo)
        ? "O Melhor Envio (70010) não está cadastrado e ativo como transportadora no Vibe."
        : "transportadora.cnpj não corresponde a uma transportadora cadastrada e ativa no Vibe.",
      "transportadora_nao_cadastrada"
    );
  }

  // Itens pelas funções da tela.
  const campos = new Map<number, string[]>();
  for (const c of (camposRes.data ?? []) as Array<{ id_produto: number; campo: string }>) {
    campos.set(Number(c.id_produto), [...(campos.get(Number(c.id_produto)) ?? []), c.campo]);
  }
  const linhas = (produtosRes.data ?? []) as SupabaseProdutoRow[];
  const itensTela: PropostaItem[] = [];
  const itensPayload: Array<{ linha: Record<string, unknown>; lotes: Record<string, unknown>[] }> = [];
  for (const v of validado.itens) {
    const row = linhas.find((l) => Number((l as { id_produto?: number }).id_produto) === v.produto.id);
    const produto = row ? mapSupabaseProdutoRowToProduto(row) : null;
    if (!produto || (row as { ativo?: boolean }).ativo === false) return recusa(`O produto ${v.produto.id} está inativo no Vibe.`, "produto_inativo");
    if ((row as { is_estoque?: boolean }).is_estoque !== true) return recusa(`O produto ${v.produto.id} não é de prateleira no Vibe.`, "produto_nao_aceito");
    const item = createItemFromProduto(produto, v.quantidade, 0, false);
    itensTela.push(item);
    const { id_int: _i, ...linha } = montarDadosItemProposta(item, 0);
    void _i;
    const visivel = checklistVisivel(campos.get(v.produto.id));
    const lotes = v.lotes.map((l, i) => {
      const { id_int: _a, id_produto_proposta_origem: _b, ...lote } = montarInsertDeLoteDaProposta(
        {
          isPersisted: false,
          nome_modelo: item.nome,
          padrao: l.cor,
          quantidade: l.quantidade,
          tipo_numeracao: null,
          numeracao_inicio: null,
          numeracao_fim: null,
          verso_tipo: null
        },
        { idInt: 0, idItem: 0, variacoesTexto: null, ordem: i + 1 },
        visivel
      ) as Record<string, unknown>;
      void _a;
      void _b;
      return lote;
    });
    itensPayload.push({ linha, lotes });
  }

  // Frete FOB: as mesmas regras do Salvar.
  const nomeTransp = nomeTransportadoraCadastro(transportadora);
  const freteNome = nomeTransporteEfetivo(null, "FOB", nomeTransp);
  const categoriaFrete = categoriaDoServico(freteNome, null, "FOB") ?? categoriaPorNomeConhecido(freteNome, null);
  const transporteCategoria = categoriaDerivadaDaEscolha("FOB", null, false);
  const resumo = calculateResumo(itensTela, [], 0, "VALOR");

  // Conversas do Guru: todas as da Lisiton; principal = a da configuração.
  const conversas = await conversasDoCliente(service, ID_CLIENTE_LISITON);
  if (conversas === null) return recusa("Falha ao ler as conversas do ChatGuru.", "erro_interno", 500);
  const principal = conversas.find((c) => c.chat_id === cfg.chat_id_principal);
  if (!principal) return recusa("A conversa principal da Lisiton não está mais no ChatGuru. Fale com o Vibe.", "erro_interno", 500);
  const contatoDaPrincipal = ((contatosRes.data ?? []) as Array<{ id: number; nome_contato: string | null; whats: string | null; ativo: boolean | null }>)
    .filter((c) => c.ativo !== false)
    .find((c) => mesmoTelefone(c.whats, principal.numero));

  const lisitonNome = txt((lisitonRes.data as { nome?: string } | null)?.nome) || "LISITON";
  const e = corpo.endereco ?? {};
  const contatoNome = txt(contatoDaPrincipal?.nome_contato) || principal.nome;
  const observacao = txt(corpo.observacao, 1000);
  const texto = buildPropostaInformalText({
    id_int: "NOVO",
    clienteNome: lisitonNome,
    itens: itensTela,
    resumo,
    formaPagamento: "PIX",
    contatoNome,
    cidade: txt(e.cidade),
    uf: txt(e.uf).toUpperCase(),
    modalidade: "FOB"
  });

  return {
    ok: true,
    chave: validado.chave,
    payload: {
      chave: validado.chave,
      hash: hashDoPedido(corpo),
      vendedora: { uid: vendedora.user_id, nome: nomeVendedora, id_vendedor: vendedora.id_vendedor || vendedora.user_id },
      pagador: {
        documento: digitos(corpo.cliente?.documento),
        nome: txt(corpo.cliente?.nome),
        email: txt(corpo.cliente?.email) || null,
        telefone: digitos(corpo.cliente?.telefone) || null
      },
      endereco: {
        cep: digitos(e.cep),
        endereco: txt(e.logradouro),
        numero: txt(e.numero, 30),
        complemento: txt(e.complemento) || null,
        bairro: txt(e.bairro),
        cidade: txt(e.cidade),
        uf: txt(e.uf).toUpperCase()
      },
      proposta: {
        cliente: lisitonNome,
        empresa: empresa.labelCurta,
        id_transportadora_cliente: transportadora.id_cliente,
        frete_escolhido: freteNome,
        categoria_frete: categoriaFrete,
        transporte_categoria: transporteCategoria,
        valor: resumo.subtotalProdutos,
        valor_total: resumo.valorTotal,
        texto_whatsapp: texto,
        proposta: texto || "Orçamento conforme solicitação.",
        obs_proposta:
          `Pedido criado pela Integração Lisiton (chave ${validado.chave}).` + (observacao ? `\nObservação da Lisiton: ${observacao}` : ""),
        contato: contatoNome,
        id_contato: contatoDaPrincipal ? String(contatoDaPrincipal.id) : null
      },
      itens: itensPayload,
      cotacao: { servico: freteNome, prazo: "A combinar", peso: resumo.pesoTotal || null },
      conversas: conversas.map((c) => ({ chat_id: c.chat_id, nome: c.nome, telefone: c.numero, principal: c.chat_id === principal.chat_id }))
    }
  };
}
