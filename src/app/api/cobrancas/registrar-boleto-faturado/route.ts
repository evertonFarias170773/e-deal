import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { cabecalhosWebhookN8n } from "@/lib/n8n/webhook-segredo";
import {
  camposDoTituloRegistradoC6,
  lerRespostaDoRegistroC6,
  montarPayloadBoletoC6,
  resolverPagadorDoBoletoC6
} from "@/features/cobrancas/services/boleto-c6";
import { estadoDoRegistroBancario } from "@/features/cobrancas/lib/registro-bancario";
import {
  criarRegistroInter,
  retomarRegistroInter,
  type ResultadoDoRegistro,
  type TituloLido
} from "@/features/cobrancas/services/registro-inter";

/**
 * Registro bancário de um título faturado do Registro de Recebíveis.
 *
 * O roteamento por empresa é decidido AQUI, com o id_empresa relido do banco —
 * nunca o que veio do cliente. A empresa 2 (Ideal Birô) emite pelo Banco Inter.
 *
 * As empresas 1 e 3 emitem pelo C6. Até 02/10/2026 esta rota devolvia
 * `delegarLegado: true` e o NAVEGADOR chamava o webhook `boletos-vibe` do n8n.
 * Agora o envio sai daqui: o título é relido do banco, o pagador vem do cadastro
 * e o corpo é montado pelas MESMAS funções que o navegador usava
 * (`@/features/cobrancas/services/boleto-c6`, recortadas sem alteração) — o
 * corpo do webhook é o de sempre. A rota também grava o retorno do banco no
 * título, como já fazia com a Birô.
 *
 * PERMISSÃO (02/10/2026): a chave `contas_receber.admin` é conferida AQUI, para
 * todas as empresas, ANTES de decidir o caminho — inclusive antes de devolver
 * `delegarLegado`. Até então a rota só conferia a sessão, e o botão "Registrar"
 * da Carteira aparecia para qualquer um que visse a tela.
 */

const WEBHOOK_BIRO_FATURADO = "https://10074.hostoo.net.br/webhook/biro-faturado-inter";
/** C6, empresas 1 e 3. Exige o cabeçalho do segredo (`cabecalhosWebhookN8n`). */
const WEBHOOK_C6_FATURADO = "https://10074.hostoo.net.br/webhook/boletos-vibe";

/**
 * Consulta de uma cobrança JÁ criada no Inter, sem criar outra (04/11/2026).
 * O webhook é do n8n e ainda não existe: sem a variável, a rota só relê o
 * título. Corpo: { codigoSolicitacao, external_reference_id, id_pagamento }.
 */
const webhookDeConsulta = () => process.env.N8N_WEBHOOK_BIRO_CONSULTA_INTER || "";
/** Abaixo do `maxDuration`: a rota responde (e grava o código) antes de a plataforma cortar. */
const LIMITE_DO_WEBHOOK_MS = 50_000;

const EMPRESA_BIRO = 2;
/** "Administrar Contas a Receber": a chave que a tela usa para as ações administrativas da Carteira. */
const PERMISSAO = "contas_receber.admin";

/**
 * O Inter devolve a cobrança como EM_PROCESSAMENTO por alguns segundos antes de
 * emitir o boleto, então o workflow reconsulta até o código de barras existir —
 * até 25s de espera, além do próprio tempo das chamadas ao banco. Com o padrão
 * da plataforma esta rota expiraria no meio, e o pior é que o n8n terminaria o
 * registro depois: sucesso no banco, erro na tela.
 */
export const maxDuration = 60;

type RegistrarRequest = {
  boletoId: string;
  /** E-mail informado na tela quando o cadastro do cliente não tem um válido. */
  overrideEmail?: string;
};

type BoletoRow = {
  id: string;
  id_int: number | null;
  id_cliente: number | null;
  id_empresa: number | null;
  id_pagamento: string | null;
  id_boleto_c6: string | null;
  n_nf: string | number | null;
  nome_cliente: string | null;
  documento: string | null;
  valor: number | null;
  vencimento: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  multa: number | null;
  juros_dia: number | null;
  descricao: string | null;
  ext_reference: string | null;
  status: string | null;
  nosso_numero: string | null;
  linha_digitavel: string | null;
};

const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
const texto = (v: unknown): string => String(v ?? "").trim();

const emailValido = (e: string): boolean => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e);

export async function POST(request: Request) {
  let body: RegistrarRequest;

  try {
    body = (await request.json()) as RegistrarRequest;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const { boletoId, overrideEmail } = body;
  if (!boletoId) {
    return NextResponse.json({ success: false, message: "Campo boletoId ausente no body." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[RegistrarBoletoFaturado] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
  }

  // A permissão vale AQUI, no servidor. A tela apenas esconde o botão.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, PERMISSAO);
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, code: "SEM_PERMISSAO", message: `Sem permissão para registrar boleto no banco (${PERMISSAO}).` },
      { status: 403 }
    );
  }

  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("id, id_int, id_cliente, id_empresa, id_pagamento, id_boleto_c6, n_nf, nome_cliente, documento, valor, vencimento, parcela, total_parcelas, multa, juros_dia, descricao, ext_reference, status, nosso_numero, linha_digitavel")
    .eq("id", boletoId)
    .maybeSingle<BoletoRow>();

  if (fetchErr || !boleto) {
    return NextResponse.json(
      { success: false, message: "Título não encontrado ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const idEmpresa = Number(boleto.id_empresa);

  // Empresas 1 e 3: C6. O mesmo fluxo que o navegador fazia, agora daqui.
  if (idEmpresa !== EMPRESA_BIRO) {
    // 1 a 3. Pagador: e-mail, endereço e documento, do cadastro. A pendência
    //        volta em palavras, como sempre voltou.
    let pagador: Awaited<ReturnType<typeof resolverPagadorDoBoletoC6>>;
    try {
      pagador = await resolverPagadorDoBoletoC6(supabase, boleto, overrideEmail);
    } catch (erro) {
      return NextResponse.json(
        { success: false, code: "CADASTRO_PENDENTE", message: erro instanceof Error ? erro.message : "Pendência no cadastro do cliente." },
        { status: 400 }
      );
    }

    // 4. O webhook do n8n, com o corpo de sempre e o cabeçalho do segredo.
    let resposta: Response;
    try {
      resposta = await fetch(WEBHOOK_C6_FATURADO, {
        method: "POST",
        headers: cabecalhosWebhookN8n(),
        body: JSON.stringify(montarPayloadBoletoC6(boleto, pagador))
      });
    } catch (erro) {
      console.error("[RegistrarBoletoFaturado] Webhook C6 inalcançável:", erro);
      return NextResponse.json(
        { success: false, code: "INTEGRACAO_INDISPONIVEL", message: "Não foi possível contatar a integração bancária. Nenhum boleto foi registrado." },
        { status: 502 }
      );
    }

    const lido = await lerRespostaDoRegistroC6(resposta);
    if (!lido.ok) {
      return NextResponse.json({ success: false, code: "BANCO_RECUSOU", message: lido.mensagem }, { status: 422 });
    }

    // 5. Grava o retorno do banco no título. O boleto JÁ existe no banco: falha
    //    aqui não vira erro, senão a tela mandaria registrar de novo e sairia um
    //    segundo boleto. A tela recebe os dados e os grava como sempre gravou.
    const { error: erroGravacao } = await supabase
      .from("boletos")
      .update(camposDoTituloRegistradoC6(lido.data))
      .eq("id", boleto.id);
    if (erroGravacao) {
      console.error(
        `[RegistrarBoletoFaturado] Boleto ${boleto.id} registrado no C6, mas o título não foi gravado: ${erroGravacao.message}`
      );
    }

    return NextResponse.json({ success: true, idEmpresa, gravado: !erroGravacao, data: lido.data });
  }

  // O título como está no banco agora: é o que o fluxo do n8n atualiza.
  const relerTitulo = async (): Promise<TituloLido | null> => {
    const { data } = await supabase
      .from("boletos")
      .select("id, id_boleto_c6, nosso_numero, linha_digitavel, url_pdf, status")
      .eq("id", boletoId)
      .maybeSingle<TituloLido>();
    return data ?? null;
  };

  // Idempotência: título que já tem o código da cobrança no Inter NÃO é
  // reenviado — um segundo envio emitiria outro boleto real (24402-A, 04/11).
  // Com boleto pronto, responde como antes; sem boleto, retoma a consulta dela.
  if (estadoDoRegistroBancario(boleto) !== "NAO_REGISTRADO") {
    const urlDaConsulta = webhookDeConsulta();
    const retomado = await retomarRegistroInter({
      titulo: boleto,
      relerTitulo,
      consultar: urlDaConsulta
        ? async (codigo) => {
            await fetch(urlDaConsulta, {
              method: "POST",
              headers: cabecalhosWebhookN8n(),
              body: JSON.stringify({ codigoSolicitacao: codigo, external_reference_id: texto(boleto.ext_reference), id_pagamento: texto(boleto.id_pagamento) }),
              signal: AbortSignal.timeout(LIMITE_DO_WEBHOOK_MS)
            });
          }
        : undefined
    });
    return respostaDoRegistro(retomado);
  }

  // Segunda barreira: a cobrança pode já ter identificador bancário mesmo com a
  // linha de `boletos` ainda sem ele. Foi exatamente o que aconteceu na execução
  // 111333 — o boleto saiu no Inter, `pagamentos_v2` foi atualizado e o vínculo
  // com `boletos` falhou. Sem esta checagem, uma nova tentativa emitiria OUTRO
  // boleto real para a mesma parcela.
  if (boleto.id_pagamento) {
    const { data: pagamento } = await supabase
      .from("pagamentos_v2")
      .select("id, cod_solicitacao_inter, linha_digitavel, url_pdf")
      .eq("id_pagamento", boleto.id_pagamento)
      .maybeSingle<{ id: string; cod_solicitacao_inter: string | null; linha_digitavel: string | null; url_pdf: string | null }>();

    const codBancario = String(pagamento?.cod_solicitacao_inter ?? "").trim();

    if (codBancario) {
      console.error(
        `[RegistrarBoletoFaturado] Inconsistente: pagamento ${boleto.id_pagamento} ja tem cod_solicitacao_inter ${codBancario}, mas o boleto ${boleto.id} nao foi vinculado.`
      );
      return NextResponse.json(
        {
          success: false,
          code: "BOLETO_JA_EMITIDO",
          message:
            "Já existe boleto emitido no banco para esta cobrança, mas ele não está vinculado a este título. Regularize o vínculo antes de emitir de novo — uma nova emissão criaria um segundo boleto real.",
          data: {
            cod_solicitacao_inter: codBancario,
            linha_digitavel: pagamento?.linha_digitavel ?? null,
            url_pdf: pagamento?.url_pdf ?? null
          }
        },
        { status: 409 }
      );
    }
  }

  if (String(boleto.status ?? "").toUpperCase() === "CANCELADO") {
    return NextResponse.json({ success: false, message: "Título cancelado não pode ser registrado." }, { status: 400 });
  }

  // `ext_reference` é o que o workflow usa (com `id_pagamento`) para achar esta
  // linha e gravar os dados do banco. Sem ela o UPDATE não casa com nada: o
  // boleto sairia real no Inter e ficaria órfão, igual à execução 111333. Barrar
  // aqui é o único ponto em que ainda dá para impedir isso — depois do POST no
  // Inter não há volta. Medido em produção: 2 dos 6 títulos da empresa 2 estão
  // sem referência, então o caso é real, não hipotético.
  const referencia = texto(boleto.ext_reference);
  if (!referencia) {
    const esperada = `P${boleto.parcela ?? 1}${boleto.total_parcelas ?? 1}${boleto.id_int ?? ""}`;
    console.error(
      `[RegistrarBoletoFaturado] Boleto ${boleto.id} sem ext_reference; emissao bloqueada antes do Inter.`
    );
    return NextResponse.json(
      {
        success: false,
        code: "SEM_REFERENCIA",
        message:
          "Este título está sem a referência que vincula o boleto de volta ao registro. Corrija a referência antes de registrar — emitir agora criaria um boleto real sem vínculo.",
        data: { referencia_esperada: esperada }
      },
      { status: 400 }
    );
  }

  const documento = soDigitos(boleto.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    return NextResponse.json(
      { success: false, message: "Documento do cliente inválido (11 dígitos para CPF ou 14 para CNPJ)." },
      { status: 400 }
    );
  }

  const valor = Number(boleto.valor ?? 0);
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ success: false, message: "Valor do título inválido." }, { status: 400 });
  }

  // Cadastro do cliente: e-mail, contato e endereço.
  let email = "";
  let whats = "";
  const endereco = { logradouro: "", numero: "", complemento: "", cidade: "", uf: "", cep: "" };

  if (boleto.id_cliente) {
    const { data: cad } = await supabase
      .from("clientes")
      .select("email, email_financeiro, email_contato, whatsapp_1")
      .eq("id_cliente", boleto.id_cliente)
      .maybeSingle<{ email: string | null; email_financeiro: string | null; email_contato: string | null; whatsapp_1: string | null }>();

    if (cad) {
      email = texto(cad.email_financeiro || cad.email || cad.email_contato);
      whats = soDigitos(cad.whatsapp_1);
    }

    const { data: ends } = await supabase
      .from("enderecos")
      .select("endereco, numero, complemento, cidade, uf, cep, tipo_endereco")
      .eq("id_cliente", boleto.id_cliente)
      .returns<Array<{ endereco: string | null; numero: string | null; complemento: string | null; cidade: string | null; uf: string | null; cep: string | null; tipo_endereco: string | null }>>();

    const escolhido = (ends || []).find((e) => texto(e.tipo_endereco) === "Principal") || (ends || [])[0];
    if (escolhido) {
      endereco.logradouro = texto(escolhido.endereco);
      endereco.numero = texto(escolhido.numero) || "S/N";
      endereco.complemento = texto(escolhido.complemento);
      endereco.cidade = texto(escolhido.cidade);
      endereco.uf = texto(escolhido.uf);
      endereco.cep = soDigitos(escolhido.cep);
    }
  }

  if (!emailValido(email)) {
    email = overrideEmail && emailValido(texto(overrideEmail)) ? texto(overrideEmail) : "financeiro@pay-ideal.com.br";
  }

  // Contrato do VIBE-BOLETO-FATURADO-INTER. O parcelador do workflow usa
  // valor_total, qtd_parcelas, intervalo e inicia_em; aqui cada título já é uma
  // parcela fechada, então vai como parcela única com o vencimento próprio.
  const vencimento = texto(boleto.vencimento).slice(0, 10);
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const diasAteVencimento = vencimento
    ? Math.max(1, Math.round((new Date(`${vencimento}T12:00:00`).getTime() - hoje.getTime()) / 86400000))
    : 3;

  const payload = {
    // Sem fallback de propósito: o workflow casa esta referência com
    // `boletos.ext_reference` para achar a linha. Mandar `id_pagamento` no lugar
    // faria o UPDATE não encontrar nada, com o boleto já emitido no banco.
    // A guarda acima garante que aqui a referência nunca é vazia.
    external_reference_id: referencia,
    valor_total: valor,
    name: texto(boleto.nome_cliente),
    id_pagamento: texto(boleto.id_pagamento),
    documento,
    email,
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento,
    cidade: endereco.cidade,
    UF: endereco.uf,
    zip_code: endereco.cep,
    qtd_parcelas: 1,
    intervalo: 0,
    inicia_em: diasAteVencimento,
    multa: Number(boleto.multa ?? 0),
    juros: Number(boleto.juros_dia ?? 0),
    descricao: texto(boleto.descricao) || `Parcela ${boleto.parcela ?? 1}/${boleto.total_parcelas ?? 1}`,
    id_cliente: Number(boleto.id_cliente ?? 0),
    nf: "",
    status: "A_VENCER",
    "e-faturado": true,
    contato: whats,
    whats,
    enviar_whats: false,
    avulso: false,
    empresa: "2",
    is_prorrogado: false
  };

  // A criação: o código da cobrança que chegar (na resposta ou gravado pelo
  // fluxo) fica no título antes de qualquer outra coisa — é ele que trava a
  // próxima tentativa. Erro depois da criação aceita deixa o título EM
  // PROCESSAMENTO, não "boleto não registrado".
  const resultado = await criarRegistroInter({
    criar: async () => {
      const resposta = await fetch(WEBHOOK_BIRO_FATURADO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(LIMITE_DO_WEBHOOK_MS)
      });
      const bruto = await resposta.text().catch(() => "");
      let corpo: unknown = null;
      try {
        corpo = bruto ? JSON.parse(bruto) : null;
      } catch {
        corpo = null;
      }
      if (!resposta.ok) console.error(`[RegistrarBoletoFaturado] Webhook retornou ${resposta.status}: ${bruto.slice(0, 300)}`);
      return { status: resposta.status, corpo };
    },
    relerTitulo,
    gravarCodigoSeVazio: async (codigo) => {
      const { data, error } = await supabase
        .from("boletos")
        .update({ id_boleto_c6: codigo })
        .eq("id", boletoId)
        // "Sem código" é nulo ou texto vazio. Em 04/11/2026 só existia nulo
        // (400 títulos, nenhum vazio); o vazio fica coberto para não escapar.
        .or("id_boleto_c6.is.null,id_boleto_c6.eq.")
        .select("id");
      if (error) {
        console.error(`[RegistrarBoletoFaturado] Código ${codigo} do Inter NÃO gravado no título ${boletoId}: ${error.message}`);
        return false;
      }
      return (data ?? []).length > 0;
    }
  });

  return respostaDoRegistro(resultado);
}

/**
 * A resposta da rota para cada desfecho do Inter. O caminho normal é o de
 * antes: `success: true` com o título relido.
 */
function respostaDoRegistro(resultado: ResultadoDoRegistro) {
  if (resultado.tipo === "REGISTRADO") {
    return NextResponse.json({ success: true, idempotente: resultado.idempotente, data: resultado.titulo });
  }
  if (resultado.tipo === "EM_PROCESSAMENTO") {
    const aviso = resultado.codigoGravado
      ? "O banco aceitou a cobrança, mas o boleto ainda não foi emitido. O título fica em processamento: não registre de novo, o boleto aparece quando o banco concluir."
      : `O banco aceitou a cobrança (código ${resultado.codigo}), mas o código NÃO foi gravado no título. Não registre de novo: avise o financeiro com este código.`;
    return NextResponse.json(
      { success: false, code: "INTER_EM_PROCESSAMENTO", emProcessamento: true, message: aviso, data: { id_boleto_c6: resultado.codigo } },
      { status: 202 }
    );
  }
  return NextResponse.json({ success: false, code: "REGISTRO_NAO_CONFIRMADO", message: resultado.mensagem }, { status: 502 });
}
