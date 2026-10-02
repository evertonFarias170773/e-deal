/**
 * Registro de boleto no C6 (empresas 1 e 3) — as peças que NÃO dependem do
 * navegador: o pagador lido do cadastro, o corpo enviado ao webhook
 * `boletos-vibe`, a leitura da resposta e os campos gravados no título.
 *
 * Saíram de `nfe.service.ts` em 02/10/2026 POR RECORTE, sem alteração de regra,
 * quando o envio ao banco passou do navegador para a rota
 * `POST /api/cobrancas/registrar-boleto-faturado`. O corpo do webhook é o mesmo
 * de sempre, campo a campo e na mesma ordem.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * O pagador de um boleto do C6, lido do CADASTRO na hora: e-mail (com o padrão
 * da empresa quando o cliente não tem um válido), endereço principal e o
 * documento só com dígitos. Lança, com a pendência em palavras, quando falta
 * algo que o banco exige.
 *
 * É o trecho que vivia dentro de `registerBoletoViaN8n`, sem alteração de
 * regra. Saiu para o "Refazer boleto" conferir o cadastro ANTES de cancelar o
 * boleto atual — descobrir a pendência só no registro deixaria o título sem
 * boleto.
 */
export async function resolverPagadorDoBoletoC6(
  client: SupabaseClient,
  boleto: Pick<SupabaseBoletoRow, "id_cliente" | "id_empresa" | "documento">,
  overrideEmail?: string
) {
  let emailDoCadastro = true;
  // 1. Fetch Client email and details
  let email = "";
  if (boleto.id_cliente) {
    const { data: cliData } = await client
      .from("clientes")
      .select("email, email_financeiro, email_contato")
      .eq("id_cliente", boleto.id_cliente)
      .maybeSingle();

    if (cliData) {
      email = (String(cliData.email_financeiro || cliData.email || cliData.email_contato || "")).trim();
    }
  }

  // Fallback de E-mail do ERP se override não foi passado
  if (!email || !isValidEmail(email)) {
    emailDoCadastro = false;
    if (overrideEmail && isValidEmail(overrideEmail)) {
      email = overrideEmail;
    } else {
      if (boleto.id_empresa === 1) {
        email = "financeiro@ingressoideal.com.br";
      } else if (boleto.id_empresa === 3) {
        email = "financeiro@e3brindes.com.br";
      } else {
        email = "financeiro@pay-ideal.com.br";
      }
    }
  }

  // Validação do email
  if (!email || !isValidEmail(email)) {
    throw new Error("O e-mail do cliente é inválido e nenhum e-mail de fallback pôde ser determinado.");
  }

  // 2. Fetch Client address
  let address = {
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: ""
  };

  if (boleto.id_cliente) {
    // Try principal first
    let { data: addrData } = await client
      .from("enderecos")
      .select("endereco, numero, complemento, bairro, cidade, uf, cep")
      .eq("id_cliente", boleto.id_cliente)
      .eq("tipo_endereco", "Principal")
      .maybeSingle();

    if (!addrData) {
      // Fallback to any address
      const { data: fallbackAddr } = await client
        .from("enderecos")
        .select("endereco, numero, complemento, bairro, cidade, uf, cep")
        .eq("id_cliente", boleto.id_cliente)
        .limit(1);

      if (fallbackAddr && fallbackAddr.length > 0) {
        addrData = fallbackAddr[0];
      }
    }

    if (addrData) {
      address = {
        logradouro: addrData.endereco || "",
        numero: addrData.numero || "",
        complemento: addrData.complemento || "",
        bairro: addrData.bairro || "",
        cidade: addrData.cidade || "",
        uf: addrData.uf || "",
        cep: addrData.cep ? String(addrData.cep).replace(/\D/g, "") : ""
      };
    }
  }

  // Validação dos campos obrigatórios de endereço
  if (!address.logradouro) {
    throw new Error("Logradouro do cliente está pendente.");
  }
  if (!address.numero) {
    throw new Error("Número do endereço do cliente está pendente.");
  }
  if (!address.cidade) {
    throw new Error("Cidade do cliente está pendente.");
  }
  if (!address.uf) {
    throw new Error("UF do cliente está pendente.");
  }
  if (!address.cep) {
    throw new Error("CEP do cliente está pendente.");
  }
  if (address.cep.length !== 8) {
    throw new Error("CEP do cliente é inválido (deve conter exatamente 8 dígitos).");
  }

  // 3. Documento do pagador
  if (!boleto.documento) {
    throw new Error("Documento do cliente está pendente.");
  }
  const documentoDigits = String(boleto.documento).replace(/\D/g, "");
  if (!documentoDigits) {
    throw new Error("Documento do cliente é inválido ou vazio (deve conter apenas dígitos).");
  }
  if (documentoDigits.length !== 11 && documentoDigits.length !== 14) {
    throw new Error("Documento do cliente é inválido (deve conter 11 dígitos para CPF ou 14 dígitos para CNPJ).");
  }

  return { email, emailDoCadastro, address, documentoDigits };
}

/**
 * Mensagem legível a partir do que o webhook devolveu.
 *
 * O n8n responde ora `{ message }`, ora o objeto de erro cru do banco
 * (`{ error: { message } }`). No segundo caso `new Error(objeto)` vira
 * "[object Object]" na tela — foi o que o usuário viu quando o C6 recusou o
 * cancelamento do título 323976692 por situação do título: erro na tela, sem
 * uma palavra sobre o motivo.
 *
 * Os bancos ainda embutem o motivo real num JSON escapado dentro da própria
 * mensagem (`400 - "{...\"detail\":\"...\"}"`), então o `detail` é extraído
 * quando existe.
 */
export function mensagemDoRetornoBancario(valor: unknown, padrao: string): string {
  if (typeof valor === "string" && valor.trim()) return valor.trim();

  if (valor && typeof valor === "object") {
    const obj = valor as { message?: unknown; detail?: unknown; description?: unknown };
    const texto = String(obj.detail ?? obj.message ?? obj.description ?? "").trim();
    if (texto) {
      const limpo = texto.split("\\").join("");
      const detalhe = limpo.match(/"detail"\s*:\s*"([^"]+)"/);
      const titulo = limpo.match(/"title"\s*:\s*"([^"]+)"/);
      return String(detalhe?.[1] ?? titulo?.[1] ?? texto).trim().slice(0, 400);
    }
  }

  return padrao;
}

/** O que `resolverPagadorDoBoletoC6` devolve e o corpo do webhook usa. */
export type PagadorDoBoletoC6 = Awaited<ReturnType<typeof resolverPagadorDoBoletoC6>>;

/** Os campos do título que entram no corpo enviado ao banco. */
export type TituloParaRegistroC6 = Pick<
  SupabaseBoletoRow,
  | "id"
  | "ext_reference"
  | "id_empresa"
  | "id_cliente"
  | "id_int"
  | "n_nf"
  | "parcela"
  | "total_parcelas"
  | "valor"
  | "vencimento"
  | "nome_cliente"
  | "multa"
  | "juros_dia"
>;

/**
 * O corpo do webhook `boletos-vibe`. É o trecho que vivia dentro de
 * `registerBoletoViaN8n`, recortado sem alteração.
 */
export function montarPayloadBoletoC6(
  boleto: TituloParaRegistroC6,
  pagador: Pick<PagadorDoBoletoC6, "email" | "address" | "documentoDigits">
) {
  const { email, address, documentoDigits } = pagador;

  const n_nfStr = boleto.n_nf ? String(boleto.n_nf) : "";
  const extReference = boleto.ext_reference || "";

  const payload = {
    boleto_id: boleto.id,
    ext_reference: extReference,
    id_empresa: boleto.id_empresa ? Number(boleto.id_empresa) : 0,
    id_cliente: boleto.id_cliente ? Number(boleto.id_cliente) : 0,
    id_int: boleto.id_int ? Number(boleto.id_int) : 0,
    n_nf: n_nfStr,
    parcela: boleto.parcela ? Number(boleto.parcela) : 1,
    total_parcelas: boleto.total_parcelas ? Number(boleto.total_parcelas) : 1,
    valor: boleto.valor ? Number(boleto.valor) : 0,
    vencimento: boleto.vencimento ? String(boleto.vencimento).slice(0, 10) : "",
    nome_cliente: boleto.nome_cliente || "",
    documento: documentoDigits,
    email: email,
    endereco: address,
    multa_percentual: boleto.multa ? Number(boleto.multa) : 0,
    juros_dia_percentual: boleto.juros_dia ? Number(boleto.juros_dia) : 0,
    instrucoes: [
      `Parcela ${boleto.parcela || 1}/${boleto.total_parcelas || 1} - NF ${n_nfStr || "S/N"} - Ref ${extReference}`
    ]
  };

  return payload;
}

/**
 * Lê a resposta do webhook como `registerBoletoViaN8n` lia: mesmas condições e
 * mesmos textos. Em vez de lançar, devolve a recusa para a rota responder.
 */
export async function lerRespostaDoRegistroC6(
  response: Response
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; mensagem: string }> {
  try {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Erro no processamento do registro do boleto: ${response.statusText}`);
    }

    // Check response
    let resData;
    try {
      resData = await response.json();
    } catch {
      throw new Error("A resposta do servidor não é um JSON válido.");
    }

    if (!resData) {
      throw new Error("Resposta do banco vazia ou inválida.");
    }

    if (resData.error || resData.message || resData.status === "error" || resData.success === false) {
      throw new Error(
        mensagemDoRetornoBancario(resData.error ?? resData.message, "Erro retornado pelo webhook.")
      );
    }

    return { ok: true, data: resData as Record<string, unknown> };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : "Erro ao registrar boleto no banco." };
  }
}

/**
 * Os campos do título gravados com o retorno do banco — o MESMO mapeamento que a
 * janela "Revisar para Geração Bancária" aplica depois do registro.
 */
export function camposDoTituloRegistradoC6(c6Data: Record<string, unknown>): Record<string, string | null> {
  // Validar status retornado (limitar aos status financeiros padronizados do ERP)
  let validatedStatus = "A_VENCER";
  if (c6Data.status && ["A_RECEBER", "A_VENCER", "PAID", "CANCELADO"].includes(String(c6Data.status))) {
    validatedStatus = String(c6Data.status);
  }

  const dbUpdates: Record<string, string | null> = {
    status: validatedStatus
  };
  const texto = (valor: unknown) => (valor === null || valor === undefined || valor === "" ? null : String(valor));
  const idBoleto = texto(c6Data.id_boleto_c6 || c6Data.id);
  const nossoNumero = texto(c6Data.nosso_numero || c6Data.our_number);
  const linhaDigitavel = texto(c6Data.linha_digitavel || c6Data.digitable_line);
  const codigoBarras = texto(c6Data.codigo_barras || c6Data.bar_code);
  const urlPdf = texto(c6Data.url_pdf || c6Data.pdf_url || c6Data.pdfUrl || c6Data.urlPdf || c6Data.pdf_storage || c6Data.url || c6Data.pdf || c6Data.caminho_pdf || c6Data.boleto_pdf || null);
  const pdfStorage = texto(c6Data.pdf_storage || c6Data.pdfStorage || c6Data.storage_path || null);

  if (idBoleto) dbUpdates.id_boleto_c6 = idBoleto;
  if (nossoNumero) dbUpdates.nosso_numero = nossoNumero;
  if (linhaDigitavel) dbUpdates.linha_digitavel = linhaDigitavel;
  if (codigoBarras) dbUpdates.codigo_barras = codigoBarras;
  if (urlPdf) dbUpdates.url_pdf = urlPdf;
  if (pdfStorage) dbUpdates.pdf_storage = pdfStorage;

  return dbUpdates;
}
