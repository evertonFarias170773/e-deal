import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { promises as fs } from "fs";
import path from "path";
import QRCode from "qrcode";
import { renderToBuffer } from "@react-pdf/renderer";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { montarOsPdfViewModel } from "@/features/pedidos/services/os-viewmodel.service";
import type { OsPdfArteRef, OsPdfModelo } from "@/features/pedidos/services/os-viewmodel.service";
import { OsPdfDocument } from "@/features/pedidos/pdf/OsPdfDocument";
import { OsPdfResumoDocument } from "@/features/pedidos/pdf/OsPdfResumoDocument";
import { EMPRESA_LOGO_FILES } from "@/features/pedidos/pdf/os-pdf-assets";
import { carregarImagemComoDataUrl } from "@/features/pedidos/pdf/os-pdf-images";
import { nomeArquivoOs } from "@/features/pedidos/services/os-nome-arquivo";
import { osQrFlagAtiva, obterOuEmitirTokenOsQr } from "@/features/pedidos/services/os-qr-token.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Teto de execução explícito.
 *
 * Sem ele a rota herdava o default da plataforma (10 s no Hobby, 15 s no Pro) —
 * e o pior caso passa disso: numa instância fria, só carregar o
 * `@react-pdf/renderer` custa segundos, e a isso se somam as leituras e o
 * download das imagens. A requisição morria sem resposta, a aba recém-aberta
 * ficava em branco, e o F5 "resolvia" porque caía na mesma instância já quente.
 * Não é um pedido para demorar 60 s: é a margem para o primeiro acesso caber.
 */
export const maxDuration = 60;

const MAX_MINIATURAS_POR_MODELO = 2;

/**
 * Resolve a base canônica do QR Code.
 * Produção: exige APP_URL https válida sem path/query; ausente/inválida → null (PDF sem QR).
 * Dev: fallback para o origin da request, com aviso.
 */
function resolverBaseUrlCanonica(request: Request): string | null {
  const raw = (process.env.APP_URL || "").trim();
  const isProd = process.env.NODE_ENV === "production";

  if (raw) {
    try {
      const url = new URL(raw);
      const protocoloOk = url.protocol === "https:" || (!isProd && url.protocol === "http:");
      const semPathQuery = (url.pathname === "/" || url.pathname === "") && !url.search;
      if (protocoloOk && semPathQuery) {
        return url.origin;
      }
      console.error("[imprimir-os] APP_URL inválida (protocolo/path):", raw);
    } catch {
      console.error("[imprimir-os] APP_URL não é uma URL válida:", raw);
    }
  }

  if (!isProd) {
    console.warn("[imprimir-os] APP_URL ausente/inválida em dev — usando origin da request para o QR.");
    try {
      return new URL(request.url).origin;
    } catch {
      return null;
    }
  }

  console.error("[imprimir-os] APP_URL ausente/inválida em produção — PDF emitido SEM QR Code.");
  return null;
}

function mimeDoLogo(fileName: string): string {
  return fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

/** Pré-carrega miniaturas (apenas mimes image/* com URL pública), tolerante a falha. */
async function preencherMiniaturas(artesLists: OsPdfArteRef[][]): Promise<void> {
  const tarefas: Promise<void>[] = [];
  for (const artes of artesLists) {
    const candidatas = artes
      .filter((a) => a.publicUrl && a.mimeType.startsWith("image/"))
      .slice(0, MAX_MINIATURAS_POR_MODELO);
    for (const arte of candidatas) {
      tarefas.push(
        carregarImagemComoDataUrl(arte.publicUrl as string).then((dataUrl) => {
          arte.imagemDataUrl = dataUrl;
        })
      );
    }
  }
  await Promise.all(tarefas);
}

/**
 * Imagem grande de cada modelo no card: pedidos_modelos.arte_url é a fonte oficial.
 * Quando a arte é PDF/vetor (não renderizável pelo @react-pdf) usa-se a amostra
 * renderizada do mesmo modelo. Tolerante a falha: sem imagem o card usa placeholder.
 */
async function preencherImagensDosModelos(modelos: OsPdfModelo[]): Promise<void> {
  await Promise.all(
    modelos.map(async (modelo) => {
      const candidatas = [modelo.imagemUrl, modelo.imagemFallbackUrl].filter(
        (url): url is string => typeof url === "string" && url.trim() !== ""
      );

      // Já embutida: nada a baixar.
      const jaEmbutida = candidatas.find((url) => url.startsWith("data:image/"));
      if (jaEmbutida) {
        modelo.imagemDataUrl = jaEmbutida;
        return;
      }

      // Evita baixar artes vetoriais só para descartá-las na validação de mime.
      const baixaveis = candidatas.filter((url) => !/\.(pdf|ai|eps|svg|cdr)(\?|$)/i.test(url));
      if (baixaveis.length === 0) return;

      // As duas candidatas vão JUNTAS, e não uma depois da outra.
      //
      // Em sequência, uma primeira candidata que falha (404, mime inesperado,
      // timeout) era tempo puro somado ao da segunda — medido: 272 ms em série
      // contra 83 ms em paralelo no mesmo pedido. E cada tentativa podia esperar
      // o timeout inteiro, então o pior caso por modelo era o dobro dele.
      //
      // `find` respeita a ORDEM das candidatas, não a ordem de chegada: quando as
      // duas dão certo continua valendo `imagemUrl`, a fonte oficial, e a amostra
      // segue sendo só reserva. O custo é baixar a reserva à toa quando a
      // principal funciona — troca deliberada de banda por latência.
      const resultados = await Promise.all(baixaveis.map((url) => carregarImagemComoDataUrl(url)));
      const primeiraValida = resultados.find((dataUrl): dataUrl is string => Boolean(dataUrl));
      if (primeiraValida) modelo.imagemDataUrl = primeiraValida;
    })
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Erro legível na aba quando o PDF é aberto por navegação (o popup do "Imprimir
 * OS"), em vez do JSON cru. Chamadas programáticas seguem recebendo JSON.
 */
function respostaErro(request: Request, message: string, status: number) {
  const aceitaHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!aceitaHtml) {
    return NextResponse.json({ success: false, message }, { status });
  }
  const escapado = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>OS - ${status}</title>` +
      `<div style="font-family:system-ui,sans-serif;color:#0b2f4a;padding:32px;max-width:520px">` +
      `<h1 style="font-size:18px;margin:0 0 8px">Nao foi possivel abrir a OS</h1>` +
      `<p style="color:#475569;margin:0">${escapado}</p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idIntRaw = searchParams.get("id_int");
  const idInt = Number(idIntRaw);
  if (!idIntRaw || !Number.isInteger(idInt) || idInt <= 0) {
    return respostaErro(request, "Parâmetro id_int inválido.", 400);
  }

  // Boletim a imprimir (propostas_os_setores.id). Sem ele, mantém o
  // comportamento legado: boletim mais recente e nenhum filtro por setor.
  const idBoletim = (searchParams.get("boletim") || "").trim() || null;
  if (idBoletim && !UUID_RE.test(idBoletim)) {
    return respostaErro(request, "Parâmetro boletim inválido.", 400);
  }

  // Layout do PDF. O completo ("OS 2027", com a imagem de cada arte) é o PADRÃO
  // e continua sendo o que sai sem parâmetro nenhum — qualquer valor
  // desconhecido cai nele de propósito, para link antigo nunca mudar de
  // comportamento. `resumido` é a lista de conferência, sem imagem.
  const layoutResumido = (searchParams.get("layout") || "").trim().toLowerCase() === "resumido";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[imprimir-os] ENV Supabase ausente");
    return respostaErro(request, "Erro interno no servidor de banco de dados.", 500);
  }

  // Duas formas de sessão, mesmo usuário e mesma RLS:
  //  - Bearer: chamadas programáticas (fetch do app);
  //  - cookie: a aba abre a rota direto, que é o que faz o navegador salvar o
  //    PDF com o nome do Content-Disposition em vez do UUID de um blob.
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabase = token
    ? createSupabaseClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : await createServerSupabaseClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return respostaErro(request, "Sessão não encontrada ou expirada. Faça login novamente.", 401);
  }

  // Permissão única, sem fallback.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "pedidos.print_os");
  if (!temPermissao) {
    return respostaErro(request, "Sem permissão para imprimir OS (pedidos.print_os).", 403);
  }

  const { data: proposta, error: propostaErr } = await supabase
    .from("propostas")
    .select("id_int, empresa, vendedor, is_prd_aprovado")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaErr || !proposta) {
    return respostaErro(request, "Proposta não encontrada.", 404);
  }

  if (proposta.is_prd_aprovado !== true) {
    return respostaErro(
      request,
      "Proposta não liberada para produção — OS não pode ser impressa.",
      409
    );
  }

  const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
    empresa: proposta.empresa,
    vendedor: proposta.vendedor,
  });
  if (!escopoOk) {
    return respostaErro(request, "Acesso negado a esta proposta.", 403);
  }

  const resultado = await montarOsPdfViewModel(supabase, idInt, { incluirValores: false, idBoletim });
  if (!resultado.success) {
    return respostaErro(request, resultado.error, resultado.status);
  }
  const { vm } = resultado;

  // Imagens só quando o layout as usa. No resumido nenhuma arte é baixada — é
  // daqui que vem a diferença de tempo e de tamanho do arquivo; o nome dos
  // arquivos de arte já está no view model e não depende de download.
  if (!layoutResumido) {
    // Miniaturas de arte (pré-fetch server-side, falha → referência textual).
    await preencherMiniaturas([
      vm.artesGerais,
      ...vm.produtos.flatMap((p) => p.modelos.map((m) => m.artes)),
    ]);

    // Imagem grande de cada modelo (card do novo layout).
    await preencherImagensDosModelos(vm.produtos.flatMap((p) => p.modelos));
  }

  // Logo da empresa (asset estático — falha não impede a emissão).
  let logoDataUrl: string | null = null;
  try {
    const logoFile = EMPRESA_LOGO_FILES[vm.empresa.id];
    const logoBuffer = await fs.readFile(path.join(process.cwd(), "public", "logos", logoFile));
    logoDataUrl = `data:${mimeDoLogo(logoFile)};base64,${logoBuffer.toString("base64")}`;
  } catch (e) {
    console.warn("[imprimir-os] Falha ao carregar logo da empresa (não-fatal):", e);
  }

  // QR Code — sob OS_QR_PUBLICO_ENABLED aponta para a página pública de produção
  // (/os?t=<token> — query string: sobrevive a leitores de QR que descartam o
  // fragment; o client remove o token da URL imediatamente após capturar; rotas
  // com no-store/no-referrer/noindex). Caso contrário mantém o destino
  // autenticado do boletim. Sem base canônica válida → sem QR.
  let qrDataUrl: string | null = null;
  const baseUrl = resolverBaseUrlCanonica(request);
  if (baseUrl) {
    let qrUrl = `${baseUrl}/pedidos/boletim?id_int=${idInt}&modo=edicao`;
    if (osQrFlagAtiva()) {
      const tokenResult = await obterOuEmitirTokenOsQr(token, authData.user.id, idInt);
      if (tokenResult.success) {
        qrUrl = `${baseUrl}/os?t=${tokenResult.token}`;
      } else {
        console.error("[imprimir-os] Token do QR público indisponível (fallback p/ boletim):", tokenResult.error);
      }
    }
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl, {
        margin: 1,
        width: 256,
      });
    } catch (e) {
      console.warn("[imprimir-os] Falha ao gerar QR Code (não-fatal):", e);
    }
  }

  try {
    const componente = layoutResumido ? OsPdfResumoDocument : OsPdfDocument;
    const elemento = createElement(componente, { vm, qrDataUrl, logoDataUrl }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(elemento);
    // Nome distinto para o resumido: baixar os dois do mesmo pedido não pode
    // gerar "os_20975_FLEXO(1).pdf" sem dizer qual é qual.
    const nomeArquivo = layoutResumido
      ? nomeArquivoOs(idInt, vm.boletim.setor).replace(/\.pdf$/i, "_resumo.pdf")
      : nomeArquivoOs(idInt, vm.boletim.setor);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nomeArquivo}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[imprimir-os] Erro ao renderizar PDF:", e);
    return respostaErro(request, "Erro ao gerar o PDF da OS.", 500);
  }
}
