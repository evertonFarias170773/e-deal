import { NextResponse } from "next/server";

import { consultarReceitaCnpj } from "@/features/cadastros/services/receita-cnpj.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";
import { CONSENTIMENTO_TEXTO, CONSENTIMENTO_VERSAO } from "@/features/cadastros/lib/consentimento";
import { validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import {
  cadastroOnlineFlagAtiva,
  criarClientServiceRole,
  esperarPiso,
  hashIpCadastro,
  ipDaRequisicao,
  mascararNome,
  RECEITA_TIMEOUT_MS,
  sha256Hex
} from "@/features/cadastros/services/cadastro-online.server";

/**
 * Envio do cadastro online. Publica, sem sessao, com service_role.
 *
 * O `anon` NAO ganha nada com esta rota: nenhum grant de tabela, nenhum grant de
 * funcao. A superficie publica do banco fica exatamente como estava — quem
 * escreve e o servidor, com service_role, depois de conferir tudo aqui.
 *
 * A ORDEM DAS DEFESAS E OBRIGATORIA
 * ---------------------------------
 *   1. honeypot   — descarta antes de qualquer trabalho
 *   2. rate limit por IP
 *   3. resolve o token
 *   4. digito verificador
 *   5. procura o documento em `clientes`
 *   6. Receita (so CNPJ, so aqui)
 *   7. cria o cliente e grava a fila como APROVADO
 *
 * A Receita e o passo 6 porque e o unico que custa dinheiro e cota. Chama-la
 * antes do rate limit ou do honeypot deixaria qualquer robo queimar o orcamento
 * da casa. Documento repetido tambem nao chega la: o passo 5 corta antes.
 *
 * O PISO DE TEMPO, E O QUE ELE NAO RESOLVE
 * ----------------------------------------
 * Toda resposta demora no minimo PISO_RESPOSTA_MS. Sem isso, "ja cadastrado"
 * (uma consulta indexada, ~5 ms) e "cadastro novo" (Receita + tres inserts,
 * centenas de ms) seriam distinguiveis pelo relogio, e o endpoint viraria um
 * oraculo de "esse CNPJ e cliente da Ideal?" — que e exatamente o que a resposta
 * mascarada existe para evitar. O piso vale para TODOS os desfechos, inclusive
 * honeypot e link invalido, para que nem a forma da recusa vaze pelo tempo.
 *
 * VAZAMENTO RESIDUAL — E ESCOLHA, NAO DESCUIDO.
 * Quando a Receita passa do piso, o caminho "cadastro novo" estoura os 2,5 s e
 * fica visivelmente mais lento que o "ja cadastrado", que sempre responde no
 * piso. Ou seja: o piso esconde a diferenca ate 2,5 s, e a perde quando a
 * Receita demora mais que isso. O teto de RECEITA_TIMEOUT_MS limita o quanto
 * essa diferenca cresce, mas nao a elimina.
 *
 * A SAIDA DEFINITIVA seria tirar a Receita do caminho sincrono: gravar o
 * cadastro com o que o cliente digitou, responder no piso, e completar os dados
 * publicos depois, em segundo plano. Nao foi feito agora porque o cadastro
 * nasce APROVADO e ir para `clientes` sem razao social oficial deixaria a base
 * pior por um tempo indeterminado. Quem reabrir isto: e aqui que se mexe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pior caso: piso de 2,5 s OU Receita ate 4 s, mais tres inserts. Folga larga
// sobre o teto padrao da plataforma, sem depender do default.
export const maxDuration = 30;

type CorpoEnvio = {
  token?: string;
  documento?: string;
  tipoPessoa?: string;
  nome?: string;
  fantasia?: string;
  email?: string;
  whatsapp?: string;
  telefoneFixo?: string;
  cep?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  consentimento?: boolean;
  /**
   * HONEYPOT. Campo real, escondido por CSS, que humano nenhum ve nem tabula.
   * Robo de formulario preenche tudo que encontra — inclusive este.
   */
  site?: string;
};

/**
 * A resposta de sucesso. Usada TAMBEM no descarte por honeypot: o robo precisa
 * receber exatamente o que um envio bom receberia, senao descobre a armadilha e
 * volta sem preencher o campo.
 */
const RESPOSTA_RECEBIDO = {
  ok: true,
  situacao: "RECEBIDO",
  mensagem: "Recebemos seus dados. Seu atendente vai falar com voce."
} as const;

/**
 * Mensagem unica para token inexistente, token revogado, vendedor que saiu e
 * rate limit estourado. Distinguir os casos diria a quem sonda qual deles
 * aconteceu — inclusive "este link existe, so esta limitado agora".
 */
const RESPOSTA_LINK = {
  ok: false,
  situacao: "LINK_INDISPONIVEL",
  mensagem: "Este link nao esta mais disponivel. Fale com seu atendente."
} as const;

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function textoOuNulo(valor: unknown): string | null {
  return texto(valor) || null;
}

export async function POST(request: Request) {
  const inicio = Date.now();

  if (!cadastroOnlineFlagAtiva()) {
    return NextResponse.json(
      { ok: false, situacao: "INDISPONIVEL", mensagem: "Cadastro online indisponivel." },
      { status: 503 }
    );
  }

  let corpo: CorpoEnvio;
  try {
    corpo = (await request.json()) as CorpoEnvio;
  } catch {
    return NextResponse.json(
      { ok: false, situacao: "CORPO_INVALIDO", mensagem: "Requisicao invalida." },
      { status: 400 }
    );
  }

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[cadastro-online] SUPABASE_SERVICE_ROLE_KEY ou URL ausente.");
    return NextResponse.json(
      { ok: false, situacao: "ERRO", mensagem: "Servico indisponivel no momento." },
      { status: 500 }
    );
  }

  const token = texto(corpo.token);

  // ---------------------------------------------------------------- 1. HONEYPOT
  // Antes de tudo, inclusive do rate limit: robo nao deve nem gastar o orcamento
  // de IP de um cliente legitimo que compartilhe o mesmo NAT.
  if (texto(corpo.site)) {
    await contarDescarteHoneypot(service, token);
    await esperarPiso(inicio);
    return NextResponse.json(RESPOSTA_RECEBIDO);
  }

  // ------------------------------------------------------------ 2. RATE LIMIT IP
  // Primeira linha, barata e imperfeita: e por instancia do Next e a chave vem de
  // `x-forwarded-for`, que o cliente controla. A defesa real e a persistente por
  // token, dentro de `cadastro_link_resolver`.
  const ip = ipDaRequisicao(request);
  if (!rateLimitCheck(`cadastro-online:${ip}`, 5, 10 * 60 * 1000)) {
    await esperarPiso(inicio);
    return NextResponse.json(RESPOSTA_LINK);
  }

  // ------------------------------------------------------------- 3. TOKEN
  // O resolver confere os cinco sinais de que o vendedor saiu e aplica o rate
  // limit persistente. Token invalido, revogado, vendedor fora e limite estourado
  // voltam todos com a MESMA mensagem.
  const { data: resolvido, error: erroResolver } = await service.rpc("cadastro_link_resolver", {
    p_token: token
  });
  if (erroResolver) {
    console.error("[cadastro-online] cadastro_link_resolver falhou:", erroResolver.message);
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel enviar agora. Tente de novo em instantes." },
      { status: 500 }
    );
  }
  const link = resolvido as { ok?: boolean; id_link?: number; id_vendedor?: string; primeiro_nome?: string } | null;
  if (!link?.ok) {
    await esperarPiso(inicio);
    return NextResponse.json(RESPOSTA_LINK);
  }

  // --------------------------------------------------- 4. DIGITO VERIFICADOR
  // No SERVIDOR, nao so na tela. A tela valida para dar retorno imediato; aqui e
  // que a validacao vale, porque o corpo da requisicao nao passa pela tela.
  const tipoPessoa = texto(corpo.tipoPessoa).toUpperCase() === "FISICA" ? "FISICA" : "JURIDICA";
  const validacao = validateDocumentByTipo(texto(corpo.documento), tipoPessoa === "FISICA" ? "CPF" : "CNPJ");
  if (!validacao.isValid) {
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "DOCUMENTO_INVALIDO", mensagem: validacao.message },
      { status: 400 }
    );
  }
  const digitos = validacao.digits;

  const nome = texto(corpo.nome);
  if (!nome) {
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "DADOS_INCOMPLETOS", mensagem: "Informe o nome ou a razao social." },
      { status: 400 }
    );
  }

  if (corpo.consentimento !== true) {
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "CONSENTIMENTO_AUSENTE", mensagem: "E preciso aceitar o uso dos dados para continuar." },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------ 5. DUPLICIDADE
  // Pela VIEW, e nao pela tabela, de proposito.
  //
  // O indice `idx_clientes_documento_digitos` e de EXPRESSAO. O PostgREST nao
  // sabe escrever expressao em filtro, entao `clientes?documento=eq.X` jamais o
  // usaria — seria varredura de 9.157 paginas a cada envio, num endpoint publico.
  //
  // `vw_cadastros_lista_completa.documento_numeros` E a mesma expressao,
  // caractere por caractere. Filtrar por ela faz o planner alcancar o indice:
  //
  //   Index Scan using idx_clientes_documento_digitos on clientes c
  //   Index Cond: (regexp_replace(COALESCE(documento,''),'\D','','g') = '...')
  //   4 buffers, 0,137 ms   (medido em 07/09/2026)
  //
  // Tem de ser a `lista_completa`, NAO a `clientes_lista`: esta ultima filtra
  // `ativo AND categoria='CLIENTE'` por dentro, e um duplicado inativo (ha 2.545
  // inativos) passaria despercebido, criando o segundo cadastro do mesmo CNPJ.
  //
  // `select("nome")` e so isso: o `id_cliente` nao e nem lido, entao nao ha como
  // vazar por descuido em resposta ou log.
  const { data: existente, error: erroBusca } = await service
    .from("vw_cadastros_lista_completa")
    .select("nome")
    .eq("documento_numeros", digitos)
    .limit(1)
    .maybeSingle();

  if (erroBusca) {
    console.error("[cadastro-online] busca de duplicidade falhou:", erroBusca.message);
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel enviar agora. Tente de novo em instantes." },
      { status: 500 }
    );
  }

  if (existente) {
    // NAO grava, NAO cria, NAO devolve id_cliente nem a razao social inteira.
    // O nome mascarado serve para a pessoa reconhecer o proprio cadastro sem que
    // a resposta entregue o dado a quem so tem o documento.
    await esperarPiso(inicio);
    return NextResponse.json({
      ok: true,
      situacao: "JA_CADASTRADO",
      nomeMascarado: mascararNome(String(existente.nome ?? "")),
      mensagem: "Ja existe um cadastro com este documento. Seu atendente vai falar com voce."
    });
  }

  // --------------------------------------------------------------- 6. RECEITA
  // So aqui, e so para CNPJ: depois do honeypot, do rate limit, do token, do
  // digito verificador e da duplicidade. CPF nao consulta nada — a CPFHub e paga
  // e nao ha motivo de negocio para gastar chamada num formulario aberto.
  // A consulta do ENVIO continua sendo a validacao final. O que mudou e que ela
  // agora passa pelo cache compartilhado: quando o formulario acabou de
  // preencher os campos com este mesmo CNPJ, o dado ja esta em memoria e o
  // envio nao gasta uma segunda das 3 chamadas por minuto que a casa inteira
  // divide. Se nao estiver, consulta normalmente.
  const consulta =
    tipoPessoa === "JURIDICA" ? await consultarReceitaCnpj(digitos, RECEITA_TIMEOUT_MS) : null;
  const receita = consulta?.estado === "OK" ? consulta.dados : null;

  // ------------------------------------------------- 7. CRIA O CLIENTE E A FILA
  const emailInformado = textoOuNulo(corpo.email);
  const whatsappInformado = textoOuNulo(corpo.whatsapp);
  const telefoneInformado = textoOuNulo(corpo.telefoneFixo) || textoOuNulo(receita?.telefoneFixo);

  const insertCliente = {
    // `id_cliente` fica AUSENTE: e a ausencia que dispara o DEFAULT
    // `fn_proximo_id_cliente()`. Mandar null gravaria null em silencio.
    categoria: "CLIENTE",
    nome: receita?.razaoSocial || nome,
    fantasia: textoOuNulo(corpo.fantasia) || textoOuNulo(receita?.fantasia),
    documento: digitos,
    tipo_pessoa: tipoPessoa,
    id_vendedor: link.id_vendedor ?? null,
    nome_vendedor: textoOuNulo(link.primeiro_nome),
    email: emailInformado,
    email_contato: emailInformado,
    whatsapp_1: whatsappInformado,
    telefone_fixo: telefoneInformado,
    cidade_uf: textoOuNulo(receita?.cidadeUf) || montarCidadeUf(corpo),
    ins_estadual: textoOuNulo(receita?.insEstadual),
    tipo_contribuinte: receita ? receita.tipoContribuinte : null,
    data_fundacao: receita?.dataFundacao ?? null,
    // `ativo` tem DEFAULT false na coluna. Sem esta linha o cadastro nasceria
    // INATIVO e sumiria da lista dos atendentes.
    ativo: true,
    restricao: false,
    recebe_email: Boolean(emailInformado),
    recebe_whatsapp: Boolean(whatsappInformado),
    // Veio de formulario publico, sem ninguem conferir: `verificado` fica false
    // ate um atendente olhar.
    verificado: false
    // `nota` (default true), `padrao_pagamento` e `limite_credito` ficam de fora
    // de proposito: os defaults da coluna sao a regra da casa, e o formulario
    // publico nao tem o que dizer sobre eles.
  };

  const { data: clienteCriado, error: erroCliente } = await service
    .from("clientes")
    .insert(insertCliente)
    .select("id_cliente,nome")
    .single();

  if (erroCliente || !clienteCriado) {
    console.error("[cadastro-online] insert em clientes falhou:", erroCliente?.message);
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel concluir o cadastro. Tente de novo em instantes." },
      { status: 500 }
    );
  }

  // O numero e SEMPRE o que o banco devolveu. Cair para 0 penduraria endereco e
  // contato no id_cliente 0 — a mesma classe de erro que deixou 346 enderecos
  // orfaos na importacao de 2025. `enderecos` nao tem FK, nada barraria.
  const idCliente = Number(clienteCriado.id_cliente);
  const numeroValido = Number.isInteger(idCliente) && idCliente > 0;

  if (numeroValido) {
    const endereco = {
      id_cliente: idCliente,
      cep: textoOuNulo(corpo.cep),
      endereco: textoOuNulo(corpo.endereco),
      numero: textoOuNulo(corpo.numero),
      complemento: textoOuNulo(corpo.complemento),
      bairro: textoOuNulo(corpo.bairro),
      cidade: textoOuNulo(corpo.cidade),
      uf: texto(corpo.uf).toUpperCase().slice(0, 2) || null,
      tipo_endereco: "PRINCIPAL",
      obs: "Criado pelo cadastro online."
    };
    const temEndereco = Boolean(endereco.cep || endereco.endereco || endereco.cidade);
    if (temEndereco) {
      const { error: erroEndereco } = await service.from("enderecos").insert(endereco);
      if (erroEndereco) {
        // O cliente ja existe e o numero ja foi consumido. Derrubar tudo aqui
        // exigiria DELETE, e o desfazer desta feature e por INATIVACAO. Entao
        // registra e segue: a fila mostra o cadastro, e o atendente completa.
        console.error("[cadastro-online] endereco nao gravado:", erroEndereco.message);
      }
    }

    // Contato so quando ha o que contatar. Linha so com o nome seria ruido.
    if (emailInformado || whatsappInformado) {
      const { error: erroContato } = await service.from("contatos").insert({
        id_cliente: idCliente,
        nome_contato: nome,
        whats: whatsappInformado,
        e_mail: emailInformado
      });
      if (erroContato) {
        console.error("[cadastro-online] contato nao gravado:", erroContato.message);
      }
    }
  } else {
    console.error("[cadastro-online] insert em clientes nao devolveu id_cliente valido.");
  }

  // A linha da fila nasce APROVADO, com `aprovado_por` NULO — nulo e o registro
  // de que ninguem decidiu: foi automatico. A constraint
  // `cadastros_online_aprovado_coerente` exige `aprovado_em` e `id_cliente_gerado`
  // junto do status APROVADO, e e por isso que a linha e gravada DEPOIS do
  // insert em `clientes`, nunca antes.
  const { error: erroFila } = await service.from("cadastros_online").insert({
    id_vendedor: link.id_vendedor,
    nome_vendedor: textoOuNulo(link.primeiro_nome),
    id_link: link.id_link,
    documento: digitos,
    tipo_pessoa: tipoPessoa,
    nome,
    fantasia: textoOuNulo(corpo.fantasia),
    email: emailInformado,
    whatsapp: whatsappInformado,
    telefone_fixo: textoOuNulo(corpo.telefoneFixo),
    cep: textoOuNulo(corpo.cep),
    endereco: textoOuNulo(corpo.endereco),
    numero: textoOuNulo(corpo.numero),
    complemento: textoOuNulo(corpo.complemento),
    bairro: textoOuNulo(corpo.bairro),
    cidade: textoOuNulo(corpo.cidade),
    uf: texto(corpo.uf).toUpperCase().slice(0, 2) || null,
    status: numeroValido ? "APROVADO" : "PENDENTE",
    aprovado_em: numeroValido ? new Date().toISOString() : null,
    aprovado_por: null,
    id_cliente_gerado: numeroValido ? idCliente : null,
    consentimento_em: new Date().toISOString(),
    consentimento_texto: CONSENTIMENTO_TEXTO,
    consentimento_versao: CONSENTIMENTO_VERSAO,
    ip_hash: hashIpCadastro(ip)
  });

  if (erroFila) {
    // O cliente EXISTE. Falhar a resposta agora faria a pessoa reenviar e criar
    // o segundo cadastro. Registra o rastro perdido e confirma o recebimento.
    console.error(
      `[cadastro-online] cliente ${idCliente} criado, mas a linha da fila nao gravou:`,
      erroFila.message
    );
  }

  await registrarUsoDoLink(service, token);

  await esperarPiso(inicio);
  // Nem `id_cliente`, nem nome oficial, nem nada que a pessoa nao tenha digitado.
  return NextResponse.json(RESPOSTA_RECEBIDO);
}

function montarCidadeUf(corpo: CorpoEnvio): string | null {
  const cidade = texto(corpo.cidade);
  const uf = texto(corpo.uf).toUpperCase();
  if (!cidade || !uf) return null;
  return `${cidade} - ${uf}`;
}

/**
 * Marca o uso do link depois de um envio que virou cliente.
 *
 * `uso_count` existe na tabela desde a migration e ficaria em zero para sempre
 * se ninguem o incrementasse: quem o incrementava era `cadastro_online_registrar`,
 * a RPC que esta rota NAO usa — ela grava a fila direto, para que a linha ja
 * nasca APROVADO com o `id_cliente_gerado`, em vez de nascer PENDENTE e precisar
 * de um segundo UPDATE. Sem esta funcao, "quantos cadastros vieram por este
 * link" nao teria resposta.
 *
 * Leitura seguida de escrita pelo mesmo motivo do contador de honeypot: o
 * PostgREST nao sabe `col = col + 1`. Dois envios simultaneos no mesmo link
 * podem contar um so — para uma metrica de uso isso e aceitavel.
 */
async function registrarUsoDoLink(
  service: NonNullable<ReturnType<typeof criarClientServiceRole>>,
  token: string
): Promise<void> {
  if (!token) return;
  try {
    const hash = sha256Hex(token);
    const { data } = await service
      .from("cadastro_links")
      .select("id,uso_count")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!data) return;
    await service
      .from("cadastro_links")
      .update({ uso_count: Number(data.uso_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", data.id);
  } catch (erro) {
    console.error("[cadastro-online] falha ao registrar uso do link:", erro);
  }
}

/**
 * Conta o descarte na linha do link, SEM passar pelo resolver.
 *
 * De proposito: o resolver gasta uma tentativa do rate limit por token, e um
 * robo insistente esgotaria o limite do vendedor so batendo no honeypot —
 * derrubando o link para os clientes de verdade.
 *
 * O incremento e lido-e-escrito porque o PostgREST nao sabe fazer `col = col+1`
 * sem uma funcao no banco. Duas batidas simultaneas podem contar uma so; para um
 * medidor de abuso isso e irrelevante, e nao vale uma migration.
 */
async function contarDescarteHoneypot(
  service: NonNullable<ReturnType<typeof criarClientServiceRole>>,
  token: string
): Promise<void> {
  if (!token) return;
  try {
    const hash = sha256Hex(token);
    const { data } = await service
      .from("cadastro_links")
      .select("id,descartes_honeypot")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!data) return;
    await service
      .from("cadastro_links")
      .update({ descartes_honeypot: Number(data.descartes_honeypot ?? 0) + 1 })
      .eq("id", data.id);
  } catch (erro) {
    console.error("[cadastro-online] falha ao contar descarte de honeypot:", erro);
  }
}
