import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Registro bancário de um título faturado do Registro de Recebíveis.
 *
 * O roteamento por empresa é decidido AQUI, com o id_empresa relido do banco —
 * nunca o que veio do cliente. A empresa 2 (Ideal Birô) emite pelo Banco Inter.
 *
 * As empresas 1 e 3 seguem no fluxo legado, byte-idêntico: esta rota devolve
 * `delegarLegado: true` e o cliente chama `registerBoletoViaN8n` exatamente como
 * antes. Nenhum payload do C6 passa por aqui, então não há como regredir.
 */

const WEBHOOK_BIRO_FATURADO = "https://10074.hostoo.net.br/webhook/biro-faturado-inter";

const EMPRESA_BIRO = 2;

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

  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("id, id_int, id_cliente, id_empresa, id_pagamento, id_boleto_c6, nome_cliente, documento, valor, vencimento, parcela, total_parcelas, multa, juros_dia, descricao, ext_reference, status")
    .eq("id", boletoId)
    .maybeSingle<BoletoRow>();

  if (fetchErr || !boleto) {
    return NextResponse.json(
      { success: false, message: "Título não encontrado ou fora do escopo de acesso do usuário." },
      { status: 404 }
    );
  }

  const idEmpresa = Number(boleto.id_empresa);

  // Empresas 1 e 3: nada muda. O cliente segue no caminho legado.
  if (idEmpresa !== EMPRESA_BIRO) {
    return NextResponse.json({ success: true, delegarLegado: true, idEmpresa });
  }

  // Idempotência: título já registrado no banco não é reenviado. Sem isso, um
  // segundo clique emitiria outro boleto no Inter para a mesma parcela.
  if (boleto.id_boleto_c6) {
    return NextResponse.json({
      success: true,
      idempotente: true,
      data: { id: boleto.id, id_boleto_c6: boleto.id_boleto_c6 }
    });
  }

  if (String(boleto.status ?? "").toUpperCase() === "CANCELADO") {
    return NextResponse.json({ success: false, message: "Título cancelado não pode ser registrado." }, { status: 400 });
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
    external_reference_id: texto(boleto.ext_reference) || texto(boleto.id_pagamento) || String(boleto.id_int ?? ""),
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

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(WEBHOOK_BIRO_FATURADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (erro) {
    console.error("[RegistrarBoletoFaturado] Falha de rede ao acionar o webhook:", erro);
    return NextResponse.json(
      { success: false, message: "Não foi possível contatar a integração bancária. Nenhum título foi registrado." },
      { status: 502 }
    );
  }

  if (!webhookResponse.ok) {
    const detalhe = await webhookResponse.text().catch(() => "");
    console.error(`[RegistrarBoletoFaturado] Webhook retornou ${webhookResponse.status}: ${detalhe.slice(0, 300)}`);
    return NextResponse.json(
      { success: false, message: "O Banco Inter recusou o registro do título. Nenhuma alteração foi feita." },
      { status: 502 }
    );
  }

  const retorno = await webhookResponse.json().catch(() => null);

  if (!retorno || retorno.success === false) {
    return NextResponse.json(
      { success: false, message: retorno?.message || "A integração bancária não confirmou o registro do título." },
      { status: 502 }
    );
  }

  // O workflow grava id_boleto_c6, nosso_numero, linha_digitavel, codigo_barras
  // e url_pdf direto em `boletos`. O ERP não persiste nada aqui — relê para
  // confirmar que o registro realmente chegou ao banco de dados.
  const { data: confirmado } = await supabase
    .from("boletos")
    .select("id, id_boleto_c6, linha_digitavel, url_pdf, status")
    .eq("id", boletoId)
    .maybeSingle<{ id: string; id_boleto_c6: string | null; linha_digitavel: string | null; url_pdf: string | null; status: string | null }>();

  if (!confirmado?.id_boleto_c6) {
    console.error("[RegistrarBoletoFaturado] Webhook respondeu ok mas o titulo nao foi persistido:", boletoId);
    return NextResponse.json(
      {
        success: false,
        message: "O título foi enviado ao banco, mas o retorno não foi gravado. Verifique antes de tentar novamente."
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, idempotente: false, data: confirmado });
}
