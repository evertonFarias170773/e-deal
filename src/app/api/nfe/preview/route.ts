import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { ref } = await request.json();
    if (!ref) {
      return NextResponse.json(
        { success: false, error: "Ref da NF-e não informada." },
        { status: 400 }
      );
    }

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!anonKey) {
      return NextResponse.json(
        { success: false, error: "Supabase Anon Key não configurada no servidor." },
        { status: 500 }
      );
    }

    const url = supabaseUrl
      ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/preview-nfe-rascunho`
      : "https://pay.ai-ideal.com.br/functions/v1/preview-nfe-rascunho";

    console.info(`[API][NfePreview] Calling edge function at: ${url} for ref ${ref}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`
      },
      body: JSON.stringify({ ref })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: `Erro na Edge Function (${response.status}): ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API][NfePreview] Exception:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
