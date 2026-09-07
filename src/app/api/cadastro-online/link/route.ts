import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  criarClientServiceRole,
  derivarTokenCadastroLink,
  sha256Hex
} from "@/features/cadastros/services/cadastro-online.server";

/**
 * Emissao, consulta e rotacao do link de cadastro do vendedor.
 *
 * POR QUE E UMA ROTA, E NAO ESCRITA PELO BROWSER
 * ----------------------------------------------
 * O resto da fila (`cadastros_online`) o atendente escreve direto pelo PostgREST,
 * porque tem grant. `cadastro_links` NAO: a migration revogou `authenticated`
 * dela de proposito — a tabela guarda hash de token, e nem quem aprova cadastro
 * precisa ver. Testado: a sessao de atendente recebe "permission denied for
 * table cadastro_links".
 *
 * Alem disso, o token EM CLARO so existe onde o segredo existe. Derivar no
 * browser exigiria mandar `CADASTRO_LINK_TOKEN_SECRET` para o bundle, o que
 * acabaria com a serventia do esquema.
 *
 * QUEM PODE O QUE
 * ---------------
 *   - qualquer sessao emite, ve e rotaciona o PROPRIO link;
 *   - admin (`is_admin` ou `is_super_adm`) pode fazer o mesmo para outro vendedor;
 *   - ninguem mais ve token alheio: pedir `idVendedor` de outra pessoa sem ser
 *     admin responde 403 e nao revela se aquele vendedor existe ou tem link.
 *
 * O admin ENXERGA o token que emite para outro — nao ha como entregar o link a
 * um vendedor sem ve-lo. O que a regra impede e um usuario comum alcancar o
 * token de um colega.
 *
 * O TOKEN NAO E GUARDADO EM CLARO EM LUGAR NENHUM
 * -----------------------------------------------
 * `cadastro_links.token_hash` e o sha256. O token e REDERIVADO a cada pedido, a
 * partir do segredo e da versao ativa — e por isso que o link e fixo e
 * permanente sem nunca ser persistido. A conferencia de hash abaixo existe para
 * pegar troca de segredo: se `CADASTRO_LINK_TOKEN_SECRET` mudar, os tokens
 * derivados deixam de casar com os hashes gravados, e todos os links morrem.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = {
  /** "OBTER" devolve o link ativo, criando a v1 se ainda nao houver. */
  acao?: "OBTER" | "ROTACIONAR";
  /** So admin pode informar outro. Ausente = o proprio. */
  idVendedor?: string;
};

type LinhaUsuario = {
  user_id: string;
  id_vendedor: string | null;
  nome_usuario: string | null;
  meu_vendedor: string | null;
  is_admin: boolean | null;
  is_super_adm: boolean | null;
};

function erro(mensagem: string, status: number) {
  return NextResponse.json({ ok: false, mensagem }, { status });
}

export async function POST(request: Request) {
  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("Requisicao invalida.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[cadastro-online/link] ENV do Supabase ausente.");
    return erro("Erro interno no servidor de banco de dados.", 500);
  }

  // --- sessao (mesmo bloco das outras rotas autenticadas do projeto)
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) return erro("Sessao nao encontrada.", 401);

  const comSessao = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: auth, error: erroAuth } = await comSessao.auth.getUser();
  if (erroAuth || !auth.user) return erro("Sessao invalida.", 401);
  const uid = auth.user.id;

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[cadastro-online/link] SUPABASE_SERVICE_ROLE_KEY ausente.");
    return erro("Servico indisponivel no momento.", 500);
  }

  // --- quem esta pedindo
  const { data: quemPede, error: erroQuemPede } = await service
    .from("usuarios")
    .select("user_id,id_vendedor,nome_usuario,meu_vendedor,is_admin,is_super_adm")
    .eq("user_id", uid)
    .maybeSingle();

  if (erroQuemPede) {
    console.error("[cadastro-online/link] leitura de usuarios falhou:", erroQuemPede.message);
    return erro("Nao foi possivel identificar seu usuario.", 500);
  }
  const solicitante = quemPede as LinhaUsuario | null;
  if (!solicitante) return erro("Seu usuario nao esta cadastrado em usuarios.", 403);

  const ehAdmin = Boolean(solicitante.is_admin) || Boolean(solicitante.is_super_adm);
  const alvoPedido = String(corpo.idVendedor ?? "").trim();
  const idVendedorProprio = solicitante.id_vendedor;

  // Alvo: o proprio, ou outro — e outro so para admin.
  let idVendedor: string;
  if (!alvoPedido || alvoPedido === idVendedorProprio) {
    if (!idVendedorProprio) {
      // `cadastro_links.id_vendedor` e NOT NULL, e o resolver procura o vendedor
      // por esse valor. Sem ele nao ha o que emitir — e inventar um id criaria um
      // link que o proprio resolver recusaria.
      return erro(
        "Seu usuario nao tem codigo de vendedor (id_vendedor). Peca a um administrador para definir o seu antes de gerar o link.",
        409
      );
    }
    idVendedor = idVendedorProprio;
  } else {
    if (!ehAdmin) {
      // Mesma resposta para "nao existe" e "existe mas nao e seu": pedir o token
      // de um colega nao pode virar sonda de quem e vendedor.
      return erro("Voce so pode gerar o proprio link.", 403);
    }
    idVendedor = alvoPedido;
  }

  // --- o vendedor alvo precisa existir em usuarios, senao o link nasce morto
  const { data: alvo } = await service
    .from("usuarios")
    .select("id_vendedor,nome_usuario,meu_vendedor,is_vendedor")
    .eq("id_vendedor", idVendedor)
    .limit(1)
    .maybeSingle();

  if (!alvo) {
    return erro("Nao ha usuario com esse codigo de vendedor.", 404);
  }

  const acao = corpo.acao === "ROTACIONAR" ? "ROTACIONAR" : "OBTER";

  // --- estado atual: o ativo (se houver) e a maior versao ja usada
  const { data: existentes, error: erroExistentes } = await service
    .from("cadastro_links")
    .select("id,versao,revoked_at,token_hash,created_at,uso_count,descartes_honeypot")
    .eq("id_vendedor", idVendedor)
    .order("versao", { ascending: false });

  if (erroExistentes) {
    console.error("[cadastro-online/link] leitura de cadastro_links falhou:", erroExistentes.message);
    return erro("Nao foi possivel ler o estado do link.", 500);
  }

  const linhas = existentes ?? [];
  const ativo = linhas.find((linha) => linha.revoked_at === null) ?? null;
  const maiorVersao = linhas.reduce((maior, linha) => Math.max(maior, Number(linha.versao) || 0), 0);

  // ------------------------------------------------------------- ROTACIONAR
  // Revoga o ativo e emite a versao seguinte. O link antigo para de valer na
  // hora: o resolver confere `revoked_at` DEPOIS de travar a linha, entao nem um
  // envio em andamento passa.
  if (acao === "ROTACIONAR") {
    if (ativo) {
      const { error: erroRevoga } = await service
        .from("cadastro_links")
        .update({ revoked_at: new Date().toISOString(), revoked_by: uid })
        .eq("id", ativo.id)
        .is("revoked_at", null);
      if (erroRevoga) {
        console.error("[cadastro-online/link] revogacao falhou:", erroRevoga.message);
        return erro("Nao foi possivel revogar o link atual.", 500);
      }
    }
    return await emitir(service, idVendedor, maiorVersao + 1, uid, alvo);
  }

  // ------------------------------------------------------------------ OBTER
  if (ativo) {
    const token = derivarTokenCadastroLink(idVendedor, Number(ativo.versao));
    if (!token) return erro("CADASTRO_LINK_TOKEN_SECRET ausente ou curto demais no servidor.", 500);

    if (sha256Hex(token) !== ativo.token_hash) {
      // O segredo mudou depois da emissao. Nao adianta devolver um token que o
      // resolver nao reconhece — o caminho e rotacionar, com o segredo novo.
      console.error(
        `[cadastro-online/link] hash do link ativo nao confere (vendedor=${idVendedor}, v=${ativo.versao}) — segredo trocado?`
      );
      return erro(
        "O link ativo nao confere com o segredo atual do servidor. Gere um link novo para substituir o antigo.",
        409
      );
    }

    return NextResponse.json({
      ok: true,
      token,
      versao: Number(ativo.versao),
      criadoEm: ativo.created_at,
      usos: Number(ativo.uso_count ?? 0),
      descartesHoneypot: Number(ativo.descartes_honeypot ?? 0),
      nomeVendedor: alvo.meu_vendedor || alvo.nome_usuario || "",
      idVendedor,
      // A tela avisa quando o alvo nao esta marcado como vendedor: o resolver
      // exige is_vendedor = true, entao o link nasceria morto e ninguem
      // descobriria ate um cliente reclamar que a pagina nao abre.
      alvoEhVendedor: alvo.is_vendedor === true,
      novo: false
    });
  }

  return await emitir(service, idVendedor, maiorVersao + 1, uid, alvo);
}

async function emitir(
  service: NonNullable<ReturnType<typeof criarClientServiceRole>>,
  idVendedor: string,
  versao: number,
  uid: string,
  alvo: { nome_usuario?: string | null; meu_vendedor?: string | null; is_vendedor?: boolean | null }
) {
  const token = derivarTokenCadastroLink(idVendedor, versao);
  if (!token) return erro("CADASTRO_LINK_TOKEN_SECRET ausente ou curto demais no servidor.", 500);

  const { data, error } = await service
    .from("cadastro_links")
    .insert({
      id_vendedor: idVendedor,
      versao,
      token_hash: sha256Hex(token),
      created_by: uid
    })
    .select("id,versao,created_at,uso_count,descartes_honeypot")
    .single();

  if (error) {
    // 23505 = o indice unico. Ou dois cliques simultaneos criaram a mesma versao,
    // ou `uidx_cadastro_links_ativo` barrou um segundo ativo para o mesmo
    // vendedor. Nos dois casos o certo e reabrir a tela e ver o que venceu, e
    // NAO tentar de novo as cegas — cada tentativa queimaria uma versao.
    if (error.code === "23505") {
      return erro("Outro link para este vendedor foi criado ao mesmo tempo. Recarregue a tela.", 409);
    }
    console.error("[cadastro-online/link] insert falhou:", error.message);
    return erro("Nao foi possivel gerar o link.", 500);
  }

  return NextResponse.json({
    ok: true,
    token,
    versao: Number(data.versao),
    criadoEm: data.created_at,
    usos: Number(data.uso_count ?? 0),
    descartesHoneypot: Number(data.descartes_honeypot ?? 0),
    nomeVendedor: alvo.meu_vendedor || alvo.nome_usuario || "",
    idVendedor,
    alvoEhVendedor: alvo.is_vendedor === true,
    novo: true
  });
}
