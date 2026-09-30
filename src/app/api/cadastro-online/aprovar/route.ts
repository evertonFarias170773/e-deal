import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { criarClienteDoCadastroOnline } from "@/features/cadastros/services/cadastro-online-cliente.server";
import { consultarReceitaCnpj } from "@/features/cadastros/services/receita-cnpj.server";
import { RECEITA_TIMEOUT_MS } from "@/features/cadastros/services/cadastro-online.server";

/**
 * Aprovacao de um envio PENDENTE da fila do cadastro online.
 *
 * Desde 29/09/2026 o cadastro com CPF nasce PENDENTE e e o atendente que o
 * transforma em cliente. Ate entao nao havia "aprovar" — tudo nascia APROVADO
 * automaticamente e a fila so sabia recusar e desfazer.
 *
 * Cria o cliente com a MESMA funcao que a rota publica usa para o CNPJ
 * (`criarClienteDoCadastroOnline`): mesmas colunas, mesmos defaults. Vai com a
 * SESSAO DO ATENDENTE, nao com service_role — e assim que o resto da fila
 * escreve, `authenticated` tem INSERT em clientes/enderecos/contatos e UPDATE
 * em cadastros_online, e a auditoria fica no nome de quem aprovou.
 *
 * ORDEM: cliente primeiro, fila depois. Se a fila nao gravar depois de o
 * cliente existir, a resposta diz isso e a tela pede para tentar de novo; a
 * segunda tentativa encontra a linha ainda PENDENTE... e criaria outro cliente.
 * Por isso a fila e atualizada com trava no status (`.eq("status","PENDENTE")`)
 * e o id do cliente vai na resposta, para o atendente nao ficar as cegas.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { id?: string };

type LinhaFila = {
  id: string;
  status: string | null;
  tipo_pessoa: string | null;
  documento: string | null;
  nome: string | null;
  fantasia: string | null;
  email: string | null;
  whatsapp: string | null;
  telefone_fixo: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  id_vendedor: string | null;
  nome_vendedor: string | null;
};

function erro(mensagem: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, mensagem, ...(extra ?? {}) }, { status });
}

export async function POST(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("Requisicao invalida.", 400);
  }
  const id = String(corpo.id ?? "").trim();
  if (!id) return erro("Envio nao informado.", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[cadastro-online/aprovar] ENV do Supabase ausente.");
    return erro("Erro interno no servidor de banco de dados.", 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) return erro("Sessao nao encontrada.", 401);

  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: auth, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !auth.user) return erro("Sessao invalida.", 401);

  const { data: linha, error: erroLinha } = await supabase
    .from("cadastros_online")
    .select("id,status,tipo_pessoa,documento,nome,fantasia,email,whatsapp,telefone_fixo,cep,endereco,numero,complemento,bairro,cidade,uf,id_vendedor,nome_vendedor")
    .eq("id", id)
    .maybeSingle<LinhaFila>();

  if (erroLinha) return erro("Nao foi possivel ler o envio.", 500);
  if (!linha) return erro("Envio nao encontrado.", 404);
  if (String(linha.status ?? "").toUpperCase() !== "PENDENTE") {
    return erro("Este envio ja foi decidido. Recarregue a fila.", 409);
  }

  const tipoPessoa = String(linha.tipo_pessoa ?? "").toUpperCase() === "FISICA" ? "FISICA" : "JURIDICA";
  const documentoDigitos = String(linha.documento ?? "").replace(/\D/g, "");
  const nome = String(linha.nome ?? "").trim();
  if (!documentoDigitos || !nome) return erro("Envio sem documento ou sem nome; nao da para criar o cliente.", 409);

  // Duplicidade, de novo: o envio pode ter ficado dias na fila, e nesse meio
  // tempo o cliente pode ter sido criado por outro caminho.
  const { data: existente } = await supabase
    .from("vw_cadastros_lista_completa")
    .select("id_cliente,nome")
    .eq("documento_numeros", documentoDigitos)
    .limit(1)
    .maybeSingle<{ id_cliente: number | null; nome: string | null }>();
  if (existente) {
    return erro(
      `Ja existe o cadastro #${existente.id_cliente ?? "?"} com este documento (${existente.nome ?? ""}). Recuse o envio ou use o cadastro existente.`,
      409,
      { situacao: "JA_CADASTRADO", idCliente: existente.id_cliente }
    );
  }

  // CNPJ pendente (raro: so quando o envio publico nao conseguiu criar o cliente)
  // ganha os dados publicos da Receita, como no envio.
  const consulta = tipoPessoa === "JURIDICA" ? await consultarReceitaCnpj(documentoDigitos, RECEITA_TIMEOUT_MS) : null;
  const receita = consulta?.estado === "OK" ? consulta.dados : null;

  const criacao = await criarClienteDoCadastroOnline(supabase, {
    tipoPessoa,
    documentoDigitos,
    nome,
    fantasia: linha.fantasia,
    email: linha.email,
    whatsapp: linha.whatsapp,
    telefoneFixo: linha.telefone_fixo,
    cep: linha.cep,
    endereco: linha.endereco,
    numero: linha.numero,
    complemento: linha.complemento,
    bairro: linha.bairro,
    cidade: linha.cidade,
    uf: linha.uf,
    idVendedor: linha.id_vendedor,
    nomeVendedor: linha.nome_vendedor,
    receita
  });
  if (!criacao.ok) return erro(`Nao foi possivel criar o cliente: ${criacao.erro}`, 500);

  const { data: fila, error: erroFila } = await supabase
    .from("cadastros_online")
    .update({
      status: "APROVADO",
      aprovado_em: new Date().toISOString(),
      aprovado_por: auth.user.id,
      id_cliente_gerado: criacao.idCliente
    })
    .eq("id", id)
    .eq("status", "PENDENTE")
    .select("id")
    .maybeSingle();

  if (erroFila || !fila) {
    console.error(`[cadastro-online/aprovar] cliente ${criacao.idCliente} criado, mas a fila nao gravou:`, erroFila?.message);
    return erro(
      `O cliente #${criacao.idCliente} foi criado, mas a fila nao foi atualizada. Nao aprove de novo: abra o cadastro #${criacao.idCliente} e recuse este envio com o motivo.`,
      500,
      { idCliente: criacao.idCliente }
    );
  }

  return NextResponse.json({ ok: true, idCliente: criacao.idCliente });
}
