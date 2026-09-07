import { NextResponse } from "next/server";

import { rateLimitCheck } from "@/lib/security/rate-limit-memory";
import { validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import { consultarReceitaCnpj } from "@/features/cadastros/services/receita-cnpj.server";
import {
  cadastroOnlineFlagAtiva,
  criarClientServiceRole,
  devolverTentativaDeExibicao,
  RECEITA_TIMEOUT_MS,
  sha256Hex
} from "@/features/cadastros/services/cadastro-online.server";

/**
 * Preenchimento automatico do formulario publico a partir do CNPJ.
 *
 * POR QUE ESTA ROTA EXISTE, SE JA HA UMA DE CONSULTA
 * --------------------------------------------------
 * `/api/cadastros/consultar-documento` exige sessao (Bearer + getUser, 401 sem
 * ela) desde que as rotas de custo foram fechadas. O formulario publico nao tem
 * sessao e nao pode ganhar uma — dar sessao a um visitante seria desfazer aquele
 * fechamento.
 *
 * O que NAO se duplicou foi a chamada externa: as duas rotas e o envio usam o
 * mesmo `receita-cnpj.server.ts`, com a mesma API (`publica.cnpj.ws`) e o mesmo
 * cache. Nao ha API nova, servico novo nem contrato novo.
 *
 * O QUE ESTA ROTA E, DO PONTO DE VISTA DE QUEM ATACA
 * --------------------------------------------------
 * Um consultor de CNPJ gratuito, hospedado pela casa. Quem tem o link tem a
 * consulta. Dai a ordem abaixo ser inegociavel:
 *
 *   1. rate limit por IP     — barato, corta o script obvio
 *   2. rate limit por token  — corta o link vazado virando API
 *   3. token resolvido       — mesma resolucao do envio, no banco
 *   4. digito verificador    — CNPJ invalido NAO gasta chamada externa
 *   5. so entao a consulta
 *
 * O TETO REAL NAO E O MEU
 * -----------------------
 * `publica.cnpj.ws` responde 429 na QUARTA chamada dentro de um minuto, com
 * `retry-after: 60` — "Excedido o limite maximo de 3 consultas por minuto".
 * Medido em 07/09/2026. E por IP, e o IP e o DO SERVIDOR: a tela interna, este
 * formulario e a validacao do envio dividem as mesmas 3 por minuto.
 *
 * Por isso os meus numeros sao folgados: apertar mais nao protegeria nada que o
 * teto de la ja nao imponha, e so atrapalharia quem esta preenchendo de boa fe.
 * E por isso o cache do modulo compartilhado importa mais que o rate limit: ele
 * e que evita a segunda chamada do mesmo CNPJ.
 *
 * FALHAR AQUI NAO PODE TRAVAR NADA. Consulta indisponivel, 429 ou CNPJ ausente
 * na Receita devolvem 200 com `encontrado: false`, e o formulario segue no
 * preenchimento manual.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Corpo = { token?: string; documento?: string };

/**
 * Por IP: 6 em 10 minutos.
 *
 * Quem preenche um formulario digita UM CNPJ. O campo pode disparar de novo se a
 * pessoa corrigir um digito e completar outro CNPJ valido, entao 6 cobre varias
 * correcoes com folga. Acima disso nao e alguem preenchendo formulario.
 *
 * Bucket PROPRIO (prefixo "consulta-cnpj"), separado do envio: estourar a
 * consulta nao pode impedir a pessoa de enviar o cadastro que ela ja preencheu a
 * mao.
 */
const IP_TETO = 6;
const IP_JANELA_MS = 10 * 60 * 1000;

/**
 * Por token: 15 por hora.
 *
 * O link e do vendedor e pode ir para varios clientes no mesmo dia; 15 cobre uns
 * dez atendimentos por hora com correcoes. Abaixo do teto de envio (20/hora) de
 * proposito: e a consulta que origina chamada externa e queima a cota da casa,
 * enquanto o envio, no caminho comum, e servido pelo cache.
 *
 * Em memoria, por instancia do Next — como o de IP. O contador persistente da
 * `cadastro_links` NAO e usado aqui: ele e o do envio, e mistura-los faria a
 * consulta consumir a cota de cadastro. Manter separado era o requisito.
 */
const TOKEN_TETO = 15;
const TOKEN_JANELA_MS = 60 * 60 * 1000;

/**
 * Resposta unica para tudo que nao rendeu dado: token invalido, limite estourado,
 * CNPJ ausente na Receita, API fora do ar. O formulario trata todos igual —
 * segue manual — e quem sonda nao aprende qual foi o caso.
 */
const NAO_ENCONTRADO = { ok: true, encontrado: false } as const;

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function ipDaRequisicao(request: Request): string {
  const encaminhado = request.headers.get("x-forwarded-for") ?? "";
  const primeiro = encaminhado.split(",")[0]?.trim();
  return primeiro || request.headers.get("x-real-ip")?.trim() || "desconhecido";
}

export async function POST(request: Request) {
  if (!cadastroOnlineFlagAtiva()) {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ ok: false, encontrado: false }, { status: 400 });
  }

  const token = texto(corpo.token);
  if (!token) {
    // Sem token nao ha consulta. Recusa explicita, e nao `encontrado: false`:
    // quem chama sem token e codigo, nao pessoa preenchendo formulario.
    return NextResponse.json({ ok: false, encontrado: false, motivo: "TOKEN_AUSENTE" }, { status: 401 });
  }

  // ------------------------------------------------------------- 1. IP
  const ip = ipDaRequisicao(request);
  if (!rateLimitCheck(`consulta-cnpj:ip:${ip}`, IP_TETO, IP_JANELA_MS)) {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  // ------------------------------------------------------------- 2. TOKEN (teto)
  // Antes de resolver: um robo insistindo com o mesmo token nao deve nem chegar
  // ao banco. A chave e o hash, nunca o token em claro.
  if (!rateLimitCheck(`consulta-cnpj:token:${sha256Hex(token)}`, TOKEN_TETO, TOKEN_JANELA_MS)) {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  // ------------------------------------------------------------- 3. TOKEN (valido)
  const service = criarClientServiceRole();
  if (!service) {
    console.error("[consultar-cnpj] SUPABASE_SERVICE_ROLE_KEY ausente.");
    return NextResponse.json(NAO_ENCONTRADO);
  }

  const { data, error } = await service.rpc("cadastro_link_resolver", { p_token: token });
  if (error) {
    console.error("[consultar-cnpj] resolver falhou:", error.message);
    return NextResponse.json(NAO_ENCONTRADO);
  }
  if (!(data as { ok?: boolean } | null)?.ok) {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  // A resolucao aqui e para CONFERIR o token, nao para gravar. Devolve a
  // tentativa pelo mesmo motivo da abertura da pagina: a cota de 20/hora da
  // `cadastro_links` e do ENVIO, e preencher o formulario nao pode consumi-la.
  await devolverTentativaDeExibicao(service, token);

  // --------------------------------------------------- 4. DIGITO VERIFICADOR
  // Antes da chamada externa, sempre: CNPJ invalido nao pode custar uma das 3
  // chamadas por minuto que a casa inteira divide.
  const validacao = validateDocumentByTipo(texto(corpo.documento), "CNPJ");
  if (!validacao.isValid) {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  // ------------------------------------------------------------- 5. CONSULTA
  const resultado = await consultarReceitaCnpj(validacao.digits, RECEITA_TIMEOUT_MS);
  if (resultado.estado !== "OK") {
    return NextResponse.json(NAO_ENCONTRADO);
  }

  // SO os campos que o formulario preenche. Nada de quadro societario, situacao
  // cadastral, CNAE, porte, natureza juridica — e nunca o payload cru da API.
  // O que o modulo compartilhado traz a mais (data de fundacao, inscricao
  // estadual, tipo de contribuinte) fica no servidor: sao campos internos, que o
  // atendente ve depois, e o formulario publico nao tem onde mostra-los.
  const { dados } = resultado;
  return NextResponse.json({
    ok: true,
    encontrado: true,
    campos: {
      nome: dados.razaoSocial,
      fantasia: dados.fantasia,
      cep: dados.cep,
      endereco: dados.endereco,
      numero: dados.numero,
      complemento: dados.complemento,
      bairro: dados.bairro,
      cidade: dados.cidade,
      uf: dados.uf,
      telefoneFixo: dados.telefoneFixo,
      email: dados.email
    }
  });
}
