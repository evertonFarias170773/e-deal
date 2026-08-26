import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { escolherEnderecoPrincipal } from "@/lib/fiscal/endereco-principal";
import {
  montarAssinaturaEndereco,
  MOTIVO_CRIACAO_CADASTRO
} from "@/features/cadastros/lib/assinatura-endereco";

/**
 * Gravacao dos enderecos de um cadastro NOVO, com a regra do principal unico.
 *
 * A REGRA
 *   So pode haver UM endereco PRINCIPAL por `id_cliente`. Se ao criar o cadastro
 *   ja existir um principal naquele numero, ele e SOBRESCRITO com os dados do
 *   cadastro novo — nao herdado, nao duplicado.
 *
 * POR QUE ISTO E UMA ROTA E NAO UMA FUNCAO NO SERVICO (26/08/2026)
 *   Porque a regra tem de valer no SERVIDOR, nao so na tela. Ate aqui todo o
 *   caminho de escrita de `enderecos` saia do browser direto para o PostgREST:
 *   nao existia servidor nenhum no meio para impor coisa alguma, e a unica
 *   defesa era a boa vontade do formulario.
 *
 *   O problema que isto fecha: `enderecos` NAO tem chave estrangeira para
 *   `clientes` e o `id_cliente` de um cadastro novo e DIGITADO A MAO. Havia 346
 *   linhas orfas da importacao de 20/12/2025 — todas PRINCIPAL — esperando que
 *   alguem digitasse aquele numero. Quem digitava herdava o endereco de um
 *   estranho, marcado PRINCIPAL, e ele seguia para a etiqueta dos Correios e
 *   para o destinatario da NF-e. 18 cadastros de 2026 pegaram isso.
 *
 * O AUTOR VEM DA SESSAO, NAO DO CORPO DA REQUISICAO
 *   Quem assina o rastro e quem o token diz que e. O cliente nao tem como
 *   escolher em nome de quem grava.
 *
 * O QUE ESTA ROTA NAO FAZ
 *   - nao apaga endereco nenhum, em hipotese alguma;
 *   - nao encosta em endereco de outro tipo que ja exista no banco: os do corpo
 *     sao INSERIDOS, e o UPDATE e por `id` da linha principal eleita;
 *   - nao cria chave estrangeira nem constraint — isso e decisao de migration,
 *     fora desta rodada.
 */

type EnderecoEntrada = {
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  tipo_endereco?: string | null;
  obs?: string | null;
  recebedor?: string | null;
  cpf_recebedor?: string | null;
};

type CorpoRequisicao = {
  idCliente?: number | string;
  enderecos?: EnderecoEntrada[];
};

function texto(valor: unknown): string | null {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function ehPrincipal(tipo: unknown): boolean {
  return String(tipo ?? "").trim().toLowerCase() === "principal";
}

export async function POST(request: Request) {
  let corpo: CorpoRequisicao;
  try {
    corpo = (await request.json()) as CorpoRequisicao;
  } catch {
    return NextResponse.json({ success: false, message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const idCliente = Number(corpo.idCliente);
  if (!Number.isInteger(idCliente) || idCliente <= 0) {
    return NextResponse.json({ success: false, message: "ID do cliente invalido." }, { status: 400 });
  }

  const entradas = Array.isArray(corpo.enderecos) ? corpo.enderecos : [];
  if (entradas.length === 0) {
    return NextResponse.json({ success: true, principalAcao: "nao-informado", inseridos: 0 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[CadastrosEnderecos] ENV AUSENTE");
    return NextResponse.json({ success: false, message: "Erro interno no servidor de banco de dados." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, message: "Sessao nao encontrada." }, { status: 401 });
  }

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, message: "Sessao invalida." }, { status: 401 });
  }

  const usuario = authData.user;
  const nomeMeta =
    typeof usuario.user_metadata?.full_name === "string"
      ? usuario.user_metadata.full_name
      : typeof usuario.user_metadata?.name === "string"
        ? usuario.user_metadata.name
        : "";
  const autor = [nomeMeta, usuario.email].map((p) => (p || "").trim()).filter(Boolean).join(" — ");

  // Um cadastro tem UM principal. Mais de um no corpo e erro de quem chamou, e
  // aceitar em silencio recriaria exatamente a duplicidade que esta rota existe
  // para impedir.
  const principaisNoCorpo = entradas.filter((item) => ehPrincipal(item.tipo_endereco));
  if (principaisNoCorpo.length > 1) {
    return NextResponse.json(
      { success: false, message: "So pode haver um endereco PRINCIPAL por cadastro." },
      { status: 400 }
    );
  }

  function montarColunas(item: EnderecoEntrada) {
    return {
      cep: texto(item.cep),
      endereco: texto(item.endereco),
      numero: texto(item.numero),
      complemento: texto(item.complemento),
      bairro: texto(item.bairro),
      cidade: texto(item.cidade),
      uf: texto(item.uf),
      obs: texto(item.obs),
      recebedor: texto(item.recebedor),
      cpf_recebedor: texto(item.cpf_recebedor)
    };
  }

  let principalAcao: "sobrescrito" | "criado" | "nao-informado" = "nao-informado";
  let principalId: string | null = null;
  let principalObs: string | null = null;

  const principalNovo = principaisNoCorpo[0];
  if (principalNovo) {
    // Todos os enderecos daquele id_cliente, para a escolha usar a MESMA regra
    // da NF, da etiqueta e da reconsulta. Filtrar por tipo aqui seria uma quarta
    // regra na casa.
    const { data: existentes, error: erroLeitura } = await supabase
      .from("enderecos")
      .select("id,tipo_endereco,data_criacao")
      .eq("id_cliente", idCliente);

    if (erroLeitura) {
      return NextResponse.json(
        { success: false, message: erroLeitura.message || "Erro ao verificar enderecos existentes." },
        { status: 500 }
      );
    }

    const principalExistente = escolherEnderecoPrincipal(
      (existentes ?? []) as Array<{ id: string; tipo_endereco: string | null; data_criacao: string | null }>
    );

    if (principalExistente) {
      // SOBRESCREVE. A linha era orfa — de um cadastro que nao existe mais, ou
      // que nunca chegou a existir — e agora passa a ser deste cadastro. O `obs`
      // conta a historia, porque a tabela nao tem auditoria.
      const assinatura = montarAssinaturaEndereco(
        MOTIVO_CRIACAO_CADASTRO,
        autor,
        new Date().toISOString()
      );
      const { error } = await supabase
        .from("enderecos")
        .update({ ...montarColunas(principalNovo), tipo_endereco: "PRINCIPAL", obs: assinatura })
        .eq("id", principalExistente.id);

      if (error) {
        return NextResponse.json(
          { success: false, message: error.message || "Erro ao sobrescrever o endereco principal." },
          { status: 500 }
        );
      }

      principalAcao = "sobrescrito";
      principalId = String(principalExistente.id);
      principalObs = assinatura;
    } else {
      const { data: criado, error } = await supabase
        .from("enderecos")
        .insert({ id_cliente: idCliente, ...montarColunas(principalNovo), tipo_endereco: "PRINCIPAL" })
        .select("id")
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, message: error.message || "Erro ao criar o endereco principal." },
          { status: 500 }
        );
      }

      principalAcao = "criado";
      principalId = String((criado as { id?: string } | null)?.id ?? "");
      principalObs = texto(principalNovo.obs);
    }
  }

  // Os demais entram como sempre entraram: INSERT puro, sem regra de unicidade.
  // Um cliente pode ter varios enderecos de entrega, e isso e legitimo.
  const outros = entradas.filter((item) => !ehPrincipal(item.tipo_endereco));
  if (outros.length > 0) {
    const linhas = outros.map((item) => ({
      id_cliente: idCliente,
      ...montarColunas(item),
      tipo_endereco: texto(item.tipo_endereco) || "ENTREGA"
    }));

    const { error } = await supabase.from("enderecos").insert(linhas);
    if (error) {
      return NextResponse.json(
        { success: false, message: error.message || "Erro ao salvar os demais enderecos." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    principalAcao,
    principalId,
    principalObs,
    inseridos: outros.length
  });
}
