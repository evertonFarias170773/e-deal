import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
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
import { EMPRESA_LOGO_FILES } from "@/features/pedidos/pdf/os-pdf-assets";
import { carregarImagemComoDataUrl } from "@/features/pedidos/pdf/os-pdf-images";
import { osQrFlagAtiva, obterOuEmitirTokenOsQr } from "@/features/pedidos/services/os-qr-token.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      for (const url of candidatas) {
        if (url.startsWith("data:image/")) {
          modelo.imagemDataUrl = url;
          return;
        }
        // Evita baixar artes vetoriais só para descartá-las na validação de mime.
        if (/\.(pdf|ai|eps|svg|cdr)(\?|$)/i.test(url)) continue;
        const dataUrl = await carregarImagemComoDataUrl(url);
        if (dataUrl) {
          modelo.imagemDataUrl = dataUrl;
          return;
        }
      }
    })
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idIntRaw = searchParams.get("id_int");
  const idInt = Number(idIntRaw);
  if (!idIntRaw || !Number.isInteger(idInt) || idInt <= 0) {
    return NextResponse.json({ success: false, message: "Parâmetro id_int inválido." }, { status: 400 });
  }

  // Boletim a imprimir (pedidos_artes.id). Sem ele, mantém o comportamento
  // legado: boletim mais recente da proposta e nenhum filtro por setor.
  const idBoletim = (searchParams.get("boletim") || "").trim() || null;
  if (idBoletim && !UUID_RE.test(idBoletim)) {
    return NextResponse.json({ success: false, message: "Parâmetro boletim inválido." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[imprimir-os] ENV Supabase ausente");
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

  // Permissão única, sem fallback.
  const temPermissao = await verificarPermissaoServerSide(supabase, authData.user.id, "pedidos.print_os");
  if (!temPermissao) {
    return NextResponse.json(
      { success: false, message: "Sem permissão para imprimir OS (pedidos.print_os)." },
      { status: 403 }
    );
  }

  const { data: proposta, error: propostaErr } = await supabase
    .from("propostas")
    .select("id_int, empresa, vendedor, is_prd_aprovado")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaErr || !proposta) {
    return NextResponse.json({ success: false, message: "Proposta não encontrada." }, { status: 404 });
  }

  if (proposta.is_prd_aprovado !== true) {
    return NextResponse.json(
      { success: false, message: "Proposta não liberada para produção — OS não pode ser impressa." },
      { status: 409 }
    );
  }

  const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, {
    empresa: proposta.empresa,
    vendedor: proposta.vendedor,
  });
  if (!escopoOk) {
    return NextResponse.json({ success: false, message: "Acesso negado a esta proposta." }, { status: 403 });
  }

  const resultado = await montarOsPdfViewModel(supabase, idInt, { incluirValores: false, idBoletim });
  if (!resultado.success) {
    return NextResponse.json({ success: false, message: resultado.error }, { status: resultado.status });
  }
  const { vm } = resultado;

  // Miniaturas de arte (pré-fetch server-side, falha → referência textual).
  await preencherMiniaturas([
    vm.artesGerais,
    ...vm.produtos.flatMap((p) => p.modelos.map((m) => m.artes)),
  ]);

  // Imagem grande de cada modelo (card do novo layout).
  await preencherImagensDosModelos(vm.produtos.flatMap((p) => p.modelos));

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
    const elemento = createElement(OsPdfDocument, { vm, qrDataUrl, logoDataUrl }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(elemento);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="OS-${idInt}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[imprimir-os] Erro ao renderizar PDF:", e);
    return NextResponse.json({ success: false, message: "Erro ao gerar o PDF da OS." }, { status: 500 });
  }
}
