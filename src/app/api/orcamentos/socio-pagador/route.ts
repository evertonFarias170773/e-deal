import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeDocumentDigits, validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import { isCobrancaAtiva } from "@/features/orcamentos/services/faturado-editavel";
import type { CobrancaParaFaturado } from "@/features/orcamentos/services/faturado-editavel";
import { calcularValorPagoConfirmado } from "@/features/cobrancas/cobrancas-utils";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import type { Cobranca } from "@/features/cobrancas/types";

/**
 * SÓCIO PAGADOR SEM SAIR DO ORÇAMENTO — bloco 4, aba Geral (19/09/2026).
 *
 * O PROBLEMA QUE ISTO FECHA
 *   Incluir um pagador que ainda não é vínculo custava ~13 passos, duas janelas
 *   e um F5: abrir o cadastro do cliente, adicionar vínculo, buscar o CNPJ,
 *   criar cadastro, voltar, confirmar o vínculo, fechar, recarregar o orçamento
 *   e ainda escolher o endereço na mão.
 *
 * POR QUE UMA ROTA, E NÃO TRÊS ESCRITAS NA TELA
 *   O fluxo encadeia cadastro → endereço → vínculo → pagador. Feito no
 *   navegador, cada passo é uma janela de falha parcial sem ninguém no meio
 *   para conferir nada — e hoje `createCadastro` e
 *   `createCadastroVinculosComerciais` escrevem direto pelo PostgREST. Aqui o
 *   servidor confere sessão, trava da proposta e duplicidade ANTES de gravar.
 *
 * SESSÃO DO USUÁRIO, NUNCA service_role
 *   O client é montado com o Bearer de quem clicou. A RLS continua valendo e a
 *   autoria em `audit.logs_v2` continua sendo a pessoa, não um robô. Se a RLS
 *   recusar, a resposta é a recusa — não há escalada de privilégio aqui.
 *
 * REPETÍVEL DE PROPÓSITO
 *   Rodar duas vezes não duplica nada: o cliente é procurado pelos DÍGITOS do
 *   documento e reaproveitado; o endereço só nasce se o cadastro não tiver
 *   nenhum; o vínculo é protegido pelo UNIQUE (id_cliente_principal,
 *   id_cliente_socio) e pela leitura prévia. É o que protege do clique duplo.
 *
 * O QUE ESTA ROTA NÃO FAZ
 *   - não grava `id_endereco_ent`: o endereço de entrega continua saindo só do
 *     `saveProposta`, como desde 21/08/2026. A rota apenas devolve o endereço
 *     principal do sócio para a tela pré-selecionar;
 *   - não cria cadastro de CPF sem cadastro (caso D): não há consulta pública
 *     de CPF, e o fluxo manual segue como é hoje;
 *   - não toca na tela de Clientes nem em `/api/cadastros/consultar-documento`.
 */

/**
 * `idInt` AUSENTE = orçamento ainda não salvo (19/09/2026).
 *
 * Definir o pagador é o PRIMEIRO passo do atendente, antes dos produtos — e o
 * Salvar exige produtos. Exigir proposta aqui tornava o painel inútil justo
 * onde ele mais serve. Sem proposta, a rota faz tudo menos gravar
 * `id_faturado`: o pagador e o endereço ficam no formulário e vão para o banco
 * no primeiro Salvar, que já monta `id_faturado` a partir de `compradorId`.
 * Nesse modo quem manda o dono do vínculo é `idClientePrincipal`.
 */
type AcaoBuscar = { acao: "buscar"; idInt?: number; idClientePrincipal?: number; documento: string };
type AcaoConfirmar = {
  acao: "confirmar";
  idInt?: number;
  idClientePrincipal?: number;
  documento: string;
  /** Só no caso C: o que a prévia mostrou, para o servidor gravar o mesmo. */
  cadastroNovo?: {
    nome: string;
    fantasia?: string | null;
    emailContato?: string | null;
    telefoneFixo?: string | null;
    cidadeUf?: string | null;
    insEstadual?: string | null;
    tipoContribuinte?: string | null;
    dataFundacao?: string | null;
    endereco?: {
      cep: string;
      endereco: string;
      numero: string;
      complemento: string;
      bairro: string;
      cidade: string;
      uf: string;
    } | null;
  };
};
type Corpo = AcaoBuscar | AcaoConfirmar;

/** O que a tela precisa saber para decidir entre A, B, C e D. */
type SocioResolvido = {
  idCliente: number;
  nome: string;
  fantasia: string | null;
  documento: string;
  tipoRelacao: string;
  enderecoPrincipalId: string | null;
};

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function respostaErro(mensagem: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message: mensagem, ...(extra ?? {}) }, { status });
}

/**
 * A MESMA TRAVA DA TELA, relida no servidor.
 *
 * `isFormBloqueadoPorCobranca` (OrcamentoFormPage) é: cobrança ativa sem
 * permissão de editar paga, OU pendência de Conta Corrente aberta, OU avulsa/sem
 * produtos já paga. `ehComplemento` bloqueia à parte, porque no complemento o
 * pagador é herdado do pedido principal.
 *
 * Aqui cada parcela é lida do banco com a sessão do usuário, e as funções que
 * decidem são as MESMAS da tela (`isCobrancaAtiva`,
 * `calcularValorPagoConfirmado`) — não há segunda régua.
 *
 * A exceção do faturado a vencer NÃO é reimplementada: quem tem
 * `propostas.editar_paga` passa, e o resto é recusado. É o lado seguro — a rota
 * nunca libera o que a tela trava; no máximo recusa um caso que a tela liberaria,
 * e aí o usuário vê a mensagem em vez de um cadastro criado pela metade.
 */
async function avaliarTrava(
  supabase: SupabaseClient,
  idInt: number,
  userId: string
): Promise<{ ok: true; proposta: { id_cliente: number } } | { ok: false; motivo: string; status: number }> {
  const { data: proposta, error } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, is_avulso, id_int_pedido_principal")
    .eq("id_int", idInt)
    .maybeSingle();

  if (error) return { ok: false, motivo: "Não foi possível ler a proposta.", status: 500 };
  if (!proposta) return { ok: false, motivo: `Proposta #${idInt} não encontrada.`, status: 404 };
  if (proposta.id_cliente === null || proposta.id_cliente === undefined) {
    return { ok: false, motivo: "A proposta ainda não tem cliente definido.", status: 409 };
  }

  if (proposta.id_int_pedido_principal) {
    return {
      ok: false,
      motivo: `Pedido complementar: o pagador é herdado do #${proposta.id_int_pedido_principal}.`,
      status: 409
    };
  }

  /*
    COLUNAS QUE EXISTEM, E FALHA DE LEITURA RECUSA.

    A primeira versao pediu `valor_pago`, que NAO existe em `pagamentos_v2`: o
    PostgREST devolvia erro, a lista vinha vazia e a trava passava batido numa
    avulsa paga (pego no teste da 22417 em 19/09/2026). Agora sao as colunas
    reais que `isCobrancaAtiva` e `calcularValorPagoConfirmado` leem — status,
    tipo_cobranca, valor, confirmado, paid_at — e, se a leitura falhar, a rota
    RECUSA em vez de concluir que nao ha cobranca.
  */
  const { data: cobrancasRows, error: erroCobrancas } = await supabase
    .from("pagamentos_v2")
    .select("id, id_int, status, tipo_cobranca, valor, confirmado, paid_at")
    .eq("id_int", idInt);

  if (erroCobrancas) {
    return {
      ok: false,
      motivo: "Não foi possível conferir as cobranças desta proposta. Tente de novo.",
      status: 500
    };
  }

  const cobrancas = (cobrancasRows ?? []) as unknown as Cobranca[];
  const temCobrancaAtiva = cobrancas.some((c) => isCobrancaAtiva(c as unknown as CobrancaParaFaturado));
  const pagoConfirmado = calcularValorPagoConfirmado(cobrancas);

  const { data: itens, error: erroItens } = await supabase
    .from("produtos_proposta")
    .select("id, status_item")
    .eq("id_int", idInt);
  if (erroItens) {
    return { ok: false, motivo: "Não foi possível conferir os itens desta proposta. Tente de novo.", status: 500 };
  }
  const temProdutosAtivos = (itens ?? []).some((i) => texto(i.status_item).toUpperCase() !== "CANCELADO");

  // Avulsa (ou sem produtos ativos) já paga: ninguém edita, nem admin.
  if (pagoConfirmado > 0 && (proposta.is_avulso === true || !temProdutosAtivos)) {
    return {
      ok: false,
      motivo: "Proposta avulsa já paga não aceita alteração de pagador.",
      status: 403
    };
  }

  if (temCobrancaAtiva) {
    // A MESMA funcao de permissao das outras rotas do projeto.
    const podeEditarPaga = await verificarPermissaoServerSide(supabase, userId, "propostas.editar_paga");

    if (!podeEditarPaga) {
      return {
        ok: false,
        motivo: "A proposta tem cobrança ativa. É preciso permissão para editar proposta paga.",
        status: 403
      };
    }

    const { data: pendencias } = await supabase
      .from("conta_corrente_pendencias")
      .select("id, status")
      .eq("id_int", idInt);
    const pendenciaAberta = (pendencias ?? []).some((p) =>
      ["ABERTA", "PARCIALMENTE_RESOLVIDA"].includes(texto(p.status).toUpperCase())
    );
    if (pendenciaAberta) {
      return {
        ok: false,
        motivo: "Há pendência de Conta Corrente aberta nesta proposta. Resolva antes de trocar o pagador.",
        status: 409
      };
    }
  }

  return { ok: true, proposta: { id_cliente: Number(proposta.id_cliente) } };
}

/** Cadastro pelos DÍGITOS do documento — é o que torna a rota repetível. */
async function acharClientePorDocumento(supabase: SupabaseClient, digitos: string) {
  const { data } = await supabase
    .from("vw_cadastros_lista_completa")
    .select("id_cliente, nome, fantasia, documento")
    .eq("documento_numeros", digitos)
    .limit(1)
    .maybeSingle();
  return (data as { id_cliente: number; nome: string; fantasia: string | null; documento: string } | null) ?? null;
}

async function enderecoPrincipalDoCliente(supabase: SupabaseClient, idCliente: number) {
  const { data } = await supabase
    .from("enderecos")
    .select("id, tipo_endereco, data_criacao")
    .eq("id_cliente", idCliente)
    .order("data_criacao", { ascending: false });

  const lista = (data ?? []) as Array<{ id: string; tipo_endereco: string | null }>;
  const principal = lista.find((e) => texto(e.tipo_endereco).toUpperCase() === "PRINCIPAL");
  return { id: (principal ?? lista[0])?.id ?? null, total: lista.length };
}

async function jaEhVinculo(supabase: SupabaseClient, idPrincipal: number, idSocio: number) {
  const { data } = await supabase
    .from("clientes_socios")
    .select("id, tipo_relacao")
    .eq("id_cliente_principal", idPrincipal)
    .eq("id_cliente_socio", idSocio)
    .maybeSingle();
  return (data as { id: string; tipo_relacao: string | null } | null) ?? null;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[API][SocioPagador] ENV AUSENTE");
    return respostaErro("Erro interno no servidor de banco de dados.", 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return respostaErro("Sessão não encontrada.", 401);

  // SESSÃO DO USUÁRIO: a RLS e a autoria da auditoria continuam valendo.
  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return respostaErro("Sessão inválida.", 401);

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return respostaErro("Corpo da requisição inválido.", 400);
  }

  const idInt = Number(corpo?.idInt);
  const temProposta = Number.isInteger(idInt) && idInt > 0;

  const digitos = normalizeDocumentDigits(texto(corpo?.documento));
  const tipoPessoa = digitos.length === 14 ? "CNPJ" : "CPF";
  const validacao = validateDocumentByTipo(digitos, tipoPessoa);
  if (!validacao.isValid) {
    return respostaErro(validacao.message ?? "Documento invalido.", 400);
  }

  /*
    COM PROPOSTA: a trava do orçamento é revalidada aqui, como sempre.
    SEM PROPOSTA: não há o que travar — ninguém pagou nada ainda —, então o que
    o servidor confere é a sessão (já conferida acima) e se ESTE usuário
    enxerga o cliente principal pela RLS. Sem essa leitura, não há vínculo a
    criar.
  */
  let idClientePrincipal: number;
  if (temProposta) {
    const trava = await avaliarTrava(supabase, idInt, authData.user.id);
    if (!trava.ok) return respostaErro(trava.motivo, trava.status);
    idClientePrincipal = trava.proposta.id_cliente;
  } else {
    const informado = Number(corpo?.idClientePrincipal);
    if (!Number.isInteger(informado) || informado <= 0) {
      return respostaErro("Selecione o cliente da proposta antes de vincular um sócio.", 400);
    }
    const { data: clientePrincipal, error: erroCliente } = await supabase
      .from("clientes")
      .select("id_cliente")
      .eq("id_cliente", informado)
      .maybeSingle();
    if (erroCliente) return respostaErro("Não foi possível conferir o cliente da proposta.", 500);
    if (!clientePrincipal) return respostaErro("Cliente da proposta não encontrado.", 404);
    idClientePrincipal = Number(clientePrincipal.id_cliente);
  }

  const existente = await acharClientePorDocumento(supabase, digitos);

  // ── BUSCAR: só lê, e diz à tela qual dos quatro caminhos é ────────────────
  if (corpo.acao === "buscar") {
    if (!existente) {
      return NextResponse.json({
        success: true,
        caso: tipoPessoa === "CNPJ" ? "C" : "D",
        tipoPessoa,
        documento: digitos
      });
    }

    const vinculo = await jaEhVinculo(supabase, idClientePrincipal, Number(existente.id_cliente));
    const endereco = await enderecoPrincipalDoCliente(supabase, Number(existente.id_cliente));
    const socio: SocioResolvido = {
      idCliente: Number(existente.id_cliente),
      nome: texto(existente.nome),
      fantasia: existente.fantasia ? texto(existente.fantasia) : null,
      documento: texto(existente.documento),
      tipoRelacao: texto(vinculo?.tipo_relacao) || "vinculo_comercial",
      enderecoPrincipalId: endereco.id
    };

    if (Number(existente.id_cliente) === idClientePrincipal) {
      return NextResponse.json({
        success: true,
        caso: "PROPRIO_CLIENTE",
        socio,
        message: "Este documento é o do próprio cliente da proposta."
      });
    }

    return NextResponse.json({ success: true, caso: vinculo ? "A" : "B", socio });
  }

  // ── CONFIRMAR: cria o que faltar, sempre reaproveitando o que existe ──────
  if (corpo.acao !== "confirmar") return respostaErro("Ação desconhecida.", 400);

  let idSocio = existente ? Number(existente.id_cliente) : null;
  let criouCadastro = false;

  if (idSocio === null) {
    if (tipoPessoa !== "CNPJ") {
      return respostaErro(
        "CPF sem cadastro não é criado por aqui: cadastre o cliente e volte para vinculá-lo.",
        422
      );
    }
    const dados = corpo.cadastroNovo;
    if (!dados || !texto(dados.nome)) {
      return respostaErro("Sem os dados da consulta do CNPJ não dá para criar o cadastro.", 400);
    }

    // ATENDENTE = QUEM ESTÁ CRIANDO, a mesma regra da tela "Novo cliente":
    // o vendedor casado pelo uid do usuário logado.
    const { data: vendedorRow } = await supabase
      .from("usuarios")
      .select("id_vendedor, nome_usuario, meu_vendedor")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    const vendedor = vendedorRow as
      | { id_vendedor?: string | null; nome_usuario?: string | null; meu_vendedor?: string | null }
      | null;
    const nomeAtendente =
      texto(vendedor?.meu_vendedor) || texto(vendedor?.nome_usuario) || texto(authData.user.email);
    // `clientes.id_vendedor` e UUID. Igual a tela: o vendedor do usuario e, quando
    // ele nao tem um, o proprio uid — que e o que `vendedorOptions` ja devolve.
    const idVendedor = texto(vendedor?.id_vendedor) || authData.user.id;

    const { data: criado, error: erroCriacao } = await supabase
      .from("clientes")
      .insert({
        nome: texto(dados.nome),
        fantasia: texto(dados.fantasia) || null,
        documento: digitos,
        tipo_pessoa: "JURIDICA",
        categoria: "CLIENTE",
        ativo: true,
        email: texto(dados.emailContato) || null,
        telefone_fixo: texto(dados.telefoneFixo) || null,
        cidade_uf: texto(dados.cidadeUf) || null,
        ins_estadual: texto(dados.insEstadual) || null,
        tipo_contribuinte: texto(dados.tipoContribuinte) || null,
        data_fundacao: texto(dados.dataFundacao) || null,
        nome_vendedor: nomeAtendente || null,
        id_vendedor: idVendedor
      })
      .select("id_cliente, nome")
      .single();

    if (erroCriacao || !criado) {
      return respostaErro(
        erroCriacao?.message || "Não foi possível criar o cadastro do sócio.",
        500
      );
    }
    idSocio = Number(criado.id_cliente);
    criouCadastro = true;

    // ENDEREÇO: só se o cadastro não tiver nenhum, e pela MESMA rota oficial
    // (`/api/cadastros/enderecos`), que impõe a regra do principal único no
    // servidor. Nada de INSERT paralelo com regra própria.
    const jaTem = await enderecoPrincipalDoCliente(supabase, idSocio);
    if (jaTem.total === 0 && dados.endereco) {
      const origem = new URL(request.url).origin;
      const resposta = await fetch(`${origem}/api/cadastros/enderecos`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          idCliente: idSocio,
          enderecos: [
            {
              cep: dados.endereco.cep,
              endereco: dados.endereco.endereco,
              numero: dados.endereco.numero,
              complemento: dados.endereco.complemento,
              bairro: dados.endereco.bairro,
              cidade: dados.endereco.cidade,
              uf: dados.endereco.uf,
              tipo_endereco: "PRINCIPAL",
              obs: "Endereço importado da consulta CNPJ"
            }
          ]
        })
      });
      if (!resposta.ok) {
        // O cadastro já existe: avisar é melhor que desfazer. Quem repetir a
        // ação cai no caminho B e o endereço pode ser criado no cadastro.
        console.warn("[API][SocioPagador] Cadastro criado, endereço falhou:", await resposta.text());
      }
    }
  }

  if (idSocio === idClientePrincipal) {
    return respostaErro("Este documento é o do próprio cliente da proposta.", 409);
  }

  // VÍNCULO: lê antes, insere só se faltar. O UNIQUE do par é a última defesa.
  let criouVinculo = false;
  const vinculoExistente = await jaEhVinculo(supabase, idClientePrincipal, idSocio!);
  if (!vinculoExistente) {
    const { error: erroVinculo } = await supabase.from("clientes_socios").insert({
      id_cliente_principal: idClientePrincipal,
      id_cliente_socio: idSocio,
      tipo_relacao: "vinculo_comercial"
    });
    // 23505 = o par já existe (clique duplo). Não é erro para quem clicou.
    if (erroVinculo && erroVinculo.code !== "23505") {
      return respostaErro(erroVinculo.message || "Não foi possível criar o vínculo.", 500, {
        idClienteCriado: criouCadastro ? idSocio : undefined
      });
    }
    criouVinculo = !erroVinculo;
  }

  // PAGADOR: o mesmo caminho que o bloco 4 já usa, e a mesma gravação imediata
  // — mas só quando existe proposta. Em orçamento novo não há linha para
  // atualizar, e `id_faturado` sai do primeiro Salvar, junto do resto.
  if (temProposta) {
    const { error: erroPagador } = await supabase
      .from("propostas")
      .update({ id_faturado: idSocio })
      .eq("id_int", idInt);
    if (erroPagador) {
      return respostaErro(erroPagador.message || "Não foi possível gravar o pagador.", 500, {
        idClienteCriado: criouCadastro ? idSocio : undefined,
        vinculoCriado: criouVinculo
      });
    }
  }

  const { data: socioRow } = await supabase
    .from("clientes")
    .select("id_cliente, nome, fantasia, documento")
    .eq("id_cliente", idSocio)
    .maybeSingle();
  const endereco = await enderecoPrincipalDoCliente(supabase, idSocio!);

  const socio: SocioResolvido = {
    idCliente: idSocio!,
    nome: texto(socioRow?.nome),
    fantasia: socioRow?.fantasia ? texto(socioRow.fantasia) : null,
    documento: texto(socioRow?.documento) || digitos,
    tipoRelacao: texto(vinculoExistente?.tipo_relacao) || "vinculo_comercial",
    enderecoPrincipalId: endereco.id
  };

  return NextResponse.json({ success: true, socio, criouCadastro, criouVinculo, pagadorGravado: temProposta });
}
