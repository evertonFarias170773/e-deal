import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Link novo para o DANFE ou o XML de uma nota — assinado NA HORA do clique.
 *
 * POR QUE EXISTE
 *   O n8n sobe o PDF e o XML para o bucket `nfe-documentos` e grava em
 *   `notas_fiscais.url_danfe` / `url_xml` uma URL ASSINADA que vale 7 dias.
 *   Passada a semana, o link gravado morre: o Financeiro abria o DANFE da
 *   NFE-21869-001 e recebia `InvalidJWT: "exp" claim timestamp check failed`.
 *   Em 28/09/2026, 36 das 66 notas com DANFE já estavam com o link vencido — e
 *   as outras 30 vencem sozinhas, uma a uma, sete dias depois de emitidas.
 *
 *   O arquivo continua lá; só a assinatura expira. Esta rota assina de novo, a
 *   partir do caminho `<ref>/danfe.pdf` ou `<ref>/nfe.xml`, no momento em que o
 *   operador pede.
 *
 * POR QUE NO SERVIDOR
 *   O bucket é privado e nenhuma política de `storage.objects` dá leitura dele a
 *   `authenticated` — só o service role assina. Nada disso muda aqui: o bucket
 *   segue privado e as políticas seguem como estão.
 *
 * QUEM PODE
 *   Quem tem sessão e ENXERGA a nota. A nota é relida com o JWT do usuário, então
 *   é o RLS de `notas_fiscais` / `notas_servico` que decide; o service role só
 *   entra depois, para assinar o arquivo daquela nota e de nenhuma outra. O
 *   caminho nunca vem do corpo: é montado aqui, com a `ref` relida e um dos
 *   dois nomes de arquivo que o bucket de fato guarda.
 *
 * NADA É GRAVADO. As URLs antigas ficam no banco como estão.
 */

const BUCKET = "nfe-documentos";

const ARQUIVOS = {
  danfe: { nome: "danfe.pdf", coluna: "url_danfe", rotulo: "DANFE" },
  xml: { nome: "nfe.xml", coluna: "url_xml", rotulo: "XML" }
} as const;

type TipoArquivo = keyof typeof ARQUIVOS;

/**
 * Quanto a assinatura vale.
 *
 * `abrir` é curto: o link é usado no mesmo segundo, numa aba que o próprio
 * operador abriu. `compartilhar` é o "Copiar link", que vai por e-mail ou
 * WhatsApp para alguém abrir depois — sete dias, a mesma validade que o n8n
 * sempre deu.
 */
const VALIDADE_SEGUNDOS = {
  abrir: 10 * 60,
  compartilhar: 7 * 24 * 60 * 60
} as const;

type Finalidade = keyof typeof VALIDADE_SEGUNDOS;

/** Mesmo formato das `ref` de NF-e e NFS-e: letras, números e hífen. */
const REF_VALIDA = /^[A-Z0-9][A-Z0-9-]{2,40}$/;

export async function POST(request: Request) {
  try {
    let ref = "";
    let tipo: TipoArquivo = "danfe";
    let finalidade: Finalidade = "abrir";
    try {
      const body = (await request.json()) as { ref?: unknown; arquivo?: unknown; finalidade?: unknown };
      ref = String(body?.ref ?? "").trim().toUpperCase();
      const arquivo = String(body?.arquivo ?? "danfe").trim().toLowerCase();
      if (arquivo !== "danfe" && arquivo !== "xml") {
        return NextResponse.json({ success: false, message: "Arquivo desconhecido." }, { status: 400 });
      }
      tipo = arquivo;
      const pedida = String(body?.finalidade ?? "abrir").trim().toLowerCase();
      if (pedida !== "abrir" && pedida !== "compartilhar") {
        return NextResponse.json({ success: false, message: "Finalidade desconhecida." }, { status: 400 });
      }
      finalidade = pedida;
    } catch {
      return NextResponse.json({ success: false, message: "Corpo da requisição inválido." }, { status: 400 });
    }

    if (!REF_VALIDA.test(ref)) {
      return NextResponse.json({ success: false, message: "Referência da nota inválida." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      console.error("[API][DocumentoNota] ENV AUSENTE (url, anon ou service role)");
      return NextResponse.json(
        { success: false, message: "O servidor não está configurado para gerar o link do documento." },
        { status: 500 }
      );
    }

    // 1. Sessão.
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ success: false, message: "Sessão não encontrada." }, { status: 401 });
    }

    const doUsuario = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await doUsuario.auth.getUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, message: "Sessão inválida." }, { status: 401 });
    }

    // 2. A nota, relida com o JWT do usuário: o RLS decide se ele a enxerga.
    //    NF-e e NFS-e guardam os arquivos no mesmo bucket, pelo mesmo desenho.
    const arquivo = ARQUIVOS[tipo];
    let temArquivo = false;
    let achou = false;
    for (const tabela of ["notas_fiscais", "notas_servico"] as const) {
      const colunaServico = tipo === "danfe" ? "url_pdf" : "url_xml";
      const coluna = tabela === "notas_fiscais" ? arquivo.coluna : colunaServico;
      const { data, error } = await doUsuario
        .from(tabela)
        .select(`ref, ${coluna}`)
        .eq("ref", ref)
        .maybeSingle();
      if (error) {
        console.error(`[API][DocumentoNota] Falha ao reler ${tabela}:`, error.message);
        continue;
      }
      if (data) {
        achou = true;
        temArquivo = String((data as Record<string, unknown>)[coluna] ?? "").trim() !== "";
        break;
      }
    }

    if (!achou) {
      return NextResponse.json({ success: false, message: "Nota não encontrada." }, { status: 404 });
    }
    if (!temArquivo) {
      return NextResponse.json(
        { success: false, message: `Esta nota ainda não tem ${arquivo.rotulo} guardado.` },
        { status: 404 }
      );
    }

    // 3. A assinatura nova, com o service role, só deste arquivo desta nota.
    const servico = createSupabaseClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const caminho = `${ref}/${arquivo.nome}`;
    const validade = VALIDADE_SEGUNDOS[finalidade];
    const { data: assinada, error: erroAssinatura } = await servico.storage
      .from(BUCKET)
      .createSignedUrl(caminho, validade);

    if (erroAssinatura || !assinada?.signedUrl) {
      console.error(`[API][DocumentoNota] Falha ao assinar ${caminho}:`, erroAssinatura?.message);
      return NextResponse.json(
        {
          success: false,
          message: `Não foi possível abrir o ${arquivo.rotulo} desta nota: o arquivo não foi encontrado no armazenamento.`
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ref,
      arquivo: tipo,
      url: assinada.signedUrl,
      expiraEm: new Date(Date.now() + validade * 1000).toISOString()
    });
  } catch (err) {
    console.error("[API][DocumentoNota] Erro inesperado:", err);
    return NextResponse.json({ success: false, message: "Erro inesperado ao gerar o link." }, { status: 500 });
  }
}
