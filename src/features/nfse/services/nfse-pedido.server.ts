import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import {
  SERVICO_NFSE,
  ambienteDaEmpresa,
  decidirNfseDoPedido,
  descricaoDosItens,
  documentoDoTomador,
  empresaEmitenteDoTexto,
  empresaLiberadaParaNfse,
  type AmbienteDaEmpresa,
  type DecisaoDoPedido,
  type ServicoNfse
} from "@/features/nfse/lib/regras-emissao";
import {
  contatoOuNaoInformado,
  documentoFormatado,
  type CobrancaDoPedido,
  type ItemDoPedido
} from "@/features/nfse/lib/composicao-nfse";

/**
 * NFS-e pela Fila — o que as rotas `/api/fiscal/rascunho-nfse` e
 * `/api/fiscal/consultar-nfse` têm em comum: sessão, permissão e a releitura do
 * pedido no servidor.
 *
 * DUAS CHAVES, DOIS PAPÉIS
 *   - O cliente com o TOKEN DO USUÁRIO lê tudo o que a tela mostra (proposta,
 *     cliente, endereços, itens, notas). O RLS continua valendo.
 *   - O cliente com a chave de SERVIÇO só é usado para o que o banco fechou ao
 *     usuário comum: `fn_criar_rascunho_nfse` e `fn_nfse_codigo_municipio`. A
 *     permissão `fiscal.emit_nfse` é conferida ANTES de ele ser criado.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>;

export const COLUNAS_DA_NOTA_DE_SERVICO =
  "id, ref, id_int, id_empresa, status, status_focus, numero_nfse, url_pdf, url_xml, valor_servicos, discriminacao, " +
  "id_endereco_tomador, mensagem_prefeitura, erro_mensagem, ambiente, tentativas_envio, created_at, " +
  "id_servico_padrao, codigo_servico, codigo_nbs, codigo_verificacao, informacoes_complementares, " +
  // Só a data da emissão sai do retorno da Focus; o resto do payload não vem para a tela.
  "data_emissao:payload_retorno->>data_emissao";

export type NotaDeServicoLida = {
  id: string;
  ref: string;
  id_int: number | null;
  id_empresa: number | null;
  status: string | null;
  status_focus: string | null;
  numero_nfse: string | null;
  url_pdf: string | null;
  url_xml: string | null;
  valor_servicos: number | null;
  discriminacao: string | null;
  id_endereco_tomador: string | null;
  mensagem_prefeitura: string | null;
  erro_mensagem: string | null;
  ambiente: string | null;
  tentativas_envio: number | null;
  created_at: string | null;
  id_servico_padrao: number | null;
  codigo_servico: string | null;
  codigo_nbs: string | null;
  /** A chave de acesso da NFS-e nacional (50 dígitos), gravada na autorização. */
  codigo_verificacao: string | null;
  /** O texto gravado. Sem texto de quem emitiu, o banco guarda a reserva "NBS:" e o código. */
  informacoes_complementares: string | null;
  data_emissao: string | null;
};

export type EnderecoDoTomador = {
  id: string;
  linha: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  tipo: string;
  /** O município resolve para um código do IBGE? Sem isso a nota sai sem endereço. */
  municipioReconhecido: boolean;
};

export type ContextoNfseDoPedido = {
  idInt: number;
  totalDoPedido: number;
  /** `propostas.valor`: os itens já com o desconto geral do pedido, sem o frete. */
  valorDosProdutos: number;
  /** `propostas.valor_frete`. Não entra na nota de serviço; aparece só para explicar a diferença. */
  freteDoPedido: number;
  empresa: { id: number; nome: string; ambiente: AmbienteDaEmpresa; liberada: boolean };
  tomador: {
    idCliente: number | null;
    nome: string;
    documentoOk: boolean;
    tipoDocumento: "CPF" | "CNPJ" | null;
    /** CPF ou CNPJ com máscara, para conferência. */
    documento: string;
    email: string;
    telefone: string;
  };
  /** Os itens ativos do pedido (cancelado não vem), com o subtotal gravado. */
  itens: ItemDoPedido[];
  /**
   * As cobranças do pedido, para conferência na tela e para a janela PROPOR o
   * texto das informações complementares. O servidor não monta esse texto: ele
   * vem do navegador, como a descrição.
   */
  cobrancas: CobrancaDoPedido[];
  /** Os serviços ATIVOS de `nfse_servicos_padrao`. Vazio se o servidor não pôde ler o cadastro. */
  servicos: ServicoNfse[];
  /** O serviço que a janela traz escolhido. */
  idServicoPadrao: number;
  enderecos: EnderecoDoTomador[];
  descricaoSugerida: string;
  notas: NotaDeServicoLida[];
  decisao: DecisaoDoPedido<NotaDeServicoLida>;
};

export type SessaoFiscal = { supabase: Cliente; userId: string; nomeDoUsuario: string };

const erro = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

export const respostaDeErro = erro;

/** Sessão + `fiscal.emit_nfse`. Devolve a resposta de recusa pronta quando falha. */
export async function autenticarEmissorDeNfse(request: Request): Promise<SessaoFiscal | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[API][Nfse] ENV AUSENTE");
    return erro(500, "Erro interno no servidor de banco de dados.");
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return erro(401, "Sessão não encontrada.");

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro(401, "Sessão inválida.");

  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "fiscal.emit_nfse");
  if (!temPermissao) return erro(403, "Sem permissão para emitir NFS-e (fiscal.emit_nfse).");

  // O autor que vai para a nota sai do cadastro do usuário, nunca do navegador.
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nome_usuario")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const nome = String((usuario as { nome_usuario?: string | null } | null)?.nome_usuario ?? "").trim();

  return { supabase, userId: authData.user.id, nomeDoUsuario: nome || authData.user.email || "Usuário do Vibe" };
}

/** O cliente com a chave de serviço, só no servidor. `null` se a chave não estiver configurada. */
export function clienteDeServico(): Cliente | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
}

/**
 * Os serviços de `nfse_servicos_padrao`. A tabela é fechada ao usuário comum
 * (RLS ligado, sem policy): só o cliente de serviço a lê, e quem chama já
 * conferiu `fiscal.emit_nfse`. Só leitura — esta tela nunca cadastra serviço.
 */
export async function lerServicosNfse(servico: Cliente | null, opcoes?: { soAtivos?: boolean }): Promise<ServicoNfse[]> {
  if (!servico) return [];
  let consulta = servico
    .from("nfse_servicos_padrao")
    .select("id, nome, codigo_servico, codigo_nbs, descricao_padrao, ativo")
    .order("id", { ascending: true });
  if (opcoes?.soAtivos !== false) consulta = consulta.eq("ativo", true);
  const { data, error } = await consulta;
  if (error) {
    console.error("[API][Nfse] Falha ao ler os serviços da NFS-e:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((linha) => ({
    id: Number(linha.id),
    nome: texto(linha.nome) || `Serviço ${linha.id}`,
    codigo: texto(linha.codigo_servico) || null,
    nbs: texto(linha.codigo_nbs) || null,
    descricao: texto(linha.descricao_padrao) || null,
    ativo: linha.ativo === true
  }));
}

type Falha = { ok: false; status: number; message: string; code?: string };

/**
 * Relê, no servidor, tudo o que a janela mostra e a rota confere.
 *
 * `servico` só entra para saber se o município de cada endereço é reconhecido
 * (`fn_nfse_codigo_municipio` é fechada ao usuário comum). Sem ele, os
 * endereços voltam como "não reconhecido" e a tela avisa — a nota não é
 * bloqueada por isso.
 */
export async function lerContextoNfseDoPedido(
  supabase: Cliente,
  servico: Cliente | null,
  idInt: number
): Promise<{ ok: true; contexto: ContextoNfseDoPedido } | Falha> {
  const { data: propostaRow, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, cliente, empresa, valor, valor_total, valor_frete")
    .eq("id_int", idInt)
    .maybeSingle();
  if (propostaError) {
    console.error("[API][Nfse] Falha ao ler a proposta:", propostaError.message);
    return { ok: false, status: 500, message: "Não foi possível ler o pedido no banco." };
  }
  if (!propostaRow) return { ok: false, status: 404, message: `Pedido ${idInt} não encontrado.` };

  const proposta = propostaRow as {
    id_cliente: number | null;
    cliente: string | null;
    empresa: string | null;
    valor: number | null;
    valor_total: number | null;
    valor_frete: number | null;
  };
  const idEmpresa = empresaEmitenteDoTexto(proposta.empresa);
  const idCliente = proposta.id_cliente != null && Number(proposta.id_cliente) > 0 ? Number(proposta.id_cliente) : null;

  const [empresaRes, clienteRes, enderecosRes, itensRes, notasRes, cobrancasRes] = await Promise.all([
    supabase.from("empresas").select("id, nome_fantasia, ambiente_nfse").eq("id", idEmpresa).maybeSingle(),
    idCliente
      ? supabase
          .from("clientes")
          .select("id_cliente, nome, fantasia, documento, email_financeiro, email_contato, email, telefone_fixo, whatsapp_1, whatsapp_2")
          .eq("id_cliente", idCliente)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    idCliente
      ? supabase
          .from("enderecos")
          .select("id, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco")
          .eq("id_cliente", idCliente)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("produtos_proposta")
      .select("id, nome_produto, qtd, valor_unt, valor_sub_total, status_item")
      .eq("id_int", idInt)
      .order("id"),
    supabase.from("notas_servico").select(COLUNAS_DA_NOTA_DE_SERVICO).eq("id_int", idInt),
    // SÓ LEITURA, para a seção "Pagamento do pedido". Nunca escreve em pagamentos_v2.
    supabase
      .from("pagamentos_v2")
      .select("tipo_cobranca, forma_pgto, valor, vencimento, status, confirmado, p_qtd_parcelas, cartao_parcelas, p_intervalo, p_valor_entrada, paid_at, created_at")
      .eq("id_int", idInt)
      .order("created_at", { ascending: true })
  ]);

  const falhou = [empresaRes, clienteRes, enderecosRes, itensRes, notasRes].find((r) => r.error);
  if (falhou?.error) {
    console.error("[API][Nfse] Falha ao ler os dados do pedido:", falhou.error.message);
    return { ok: false, status: 500, message: "Não foi possível ler os dados do pedido no banco." };
  }

  const empresa = (empresaRes.data ?? null) as { nome_fantasia?: string | null; ambiente_nfse?: string | null } | null;
  const cliente = (clienteRes.data ?? null) as Record<string, string | null> | null;
  // O pagamento é conferência: se a leitura falhar, a janela abre sem a seção.
  if (cobrancasRes.error) console.warn("[API][Nfse] Não foi possível ler as cobranças do pedido:", cobrancasRes.error.message);
  const documento = documentoDoTomador(cliente?.documento);

  const enderecosBrutos = (enderecosRes.data ?? []) as Record<string, unknown>[];
  const reconhecidos = new Map<string, boolean>();
  if (servico) {
    const pares = Array.from(new Set(enderecosBrutos.map((e) => `${texto(e.cidade)}|${texto(e.uf)}`)));
    await Promise.all(
      pares.map(async (par) => {
        const [cidade, uf] = par.split("|");
        if (!cidade || !uf) return void reconhecidos.set(par, false);
        const { data, error } = await servico.rpc("fn_nfse_codigo_municipio", { p_cidade: cidade, p_uf: uf });
        if (error) console.warn("[API][Nfse] Não foi possível conferir o município:", error.message);
        reconhecidos.set(par, !error && texto(data) !== "");
      })
    );
  }

  const enderecos: EnderecoDoTomador[] = enderecosBrutos.map((e) => {
    const cidade = texto(e.cidade);
    const uf = texto(e.uf);
    const rua = [texto(e.endereco), texto(e.numero)].filter(Boolean).join(", ");
    const linha = [rua, texto(e.complemento), texto(e.bairro)].filter(Boolean).join(" - ");
    return {
      id: texto(e.id),
      linha: linha || "(endereço sem logradouro)",
      logradouro: texto(e.endereco),
      numero: texto(e.numero),
      complemento: texto(e.complemento),
      bairro: texto(e.bairro),
      cidade,
      uf,
      cep: texto(e.cep),
      tipo: texto(e.tipo_endereco),
      municipioReconhecido: reconhecidos.get(`${cidade}|${uf}`) === true
    };
  });

  // Item cancelado (inativação lógica de pedido pago) não entra na nota.
  const itens: ItemDoPedido[] = ((itensRes.data ?? []) as Record<string, unknown>[])
    .filter((i) => texto(i.status_item).toUpperCase() !== "CANCELADO")
    .map((i) => {
      const quantidade = Number(i.qtd) || 0;
      const valorUnitario = Number(i.valor_unt) || 0;
      return {
        id: Number(i.id),
        nome: texto(i.nome_produto) || `Item ${i.id}`,
        quantidade,
        valorUnitario,
        // O subtotal gravado inclui o valor fixo do item; sem ele, vale quantidade × unitário.
        subtotal: i.valor_sub_total == null ? Math.round(quantidade * valorUnitario * 100) / 100 : Number(i.valor_sub_total) || 0
      };
    });

  const cobrancas: CobrancaDoPedido[] = ((cobrancasRes.error ? [] : cobrancasRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
    tipo: texto(c.tipo_cobranca) || null,
    forma: texto(c.forma_pgto) || null,
    valor: c.valor == null ? null : Number(c.valor),
    vencimento: texto(c.vencimento) || null,
    status: texto(c.status) || null,
    confirmado: c.confirmado === true,
    parcelas: Number(c.p_qtd_parcelas) || Number(c.cartao_parcelas) || null,
    intervaloDias: c.p_intervalo == null ? null : Number(c.p_intervalo),
    valorEntrada: c.p_valor_entrada == null ? null : Number(c.p_valor_entrada),
    pagoEm: texto(c.paid_at) || null
  }));

  const servicos = await lerServicosNfse(servico);

  const notas = ((notasRes.data ?? []) as unknown as NotaDeServicoLida[]).map((n) => ({
    ...n,
    numero_nfse: n.numero_nfse == null ? null : String(n.numero_nfse)
  }));

  return {
    ok: true,
    contexto: {
      idInt,
      totalDoPedido: Number(proposta.valor_total) || Number(proposta.valor) || 0,
      valorDosProdutos: Number(proposta.valor) || 0,
      freteDoPedido: Number(proposta.valor_frete) || 0,
      empresa: {
        id: idEmpresa,
        nome: texto(empresa?.nome_fantasia) || `Empresa ${idEmpresa}`,
        ambiente: ambienteDaEmpresa(empresa?.ambiente_nfse),
        liberada: empresaLiberadaParaNfse(idEmpresa)
      },
      tomador: {
        idCliente,
        nome: texto(cliente?.nome) || texto(cliente?.fantasia) || texto(proposta.cliente) || "(cliente sem nome)",
        documentoOk: documento.ok,
        tipoDocumento: documento.tipo,
        documento: documentoFormatado(cliente?.documento),
        email: contatoOuNaoInformado(cliente?.email_financeiro || cliente?.email_contato || cliente?.email),
        telefone: contatoOuNaoInformado(cliente?.telefone_fixo || cliente?.whatsapp_1 || cliente?.whatsapp_2)
      },
      itens,
      cobrancas,
      servicos,
      idServicoPadrao: servicos.some((s) => s.id === SERVICO_NFSE.id) ? SERVICO_NFSE.id : (servicos[0]?.id ?? SERVICO_NFSE.id),
      enderecos,
      descricaoSugerida: descricaoDosItens(idInt, itens),
      notas,
      decisao: decidirNfseDoPedido(notas)
    }
  };
}

/** Número de pedido válido vindo do navegador. */
export function lerIdInt(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : Number(String(valor ?? "").trim());
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}
