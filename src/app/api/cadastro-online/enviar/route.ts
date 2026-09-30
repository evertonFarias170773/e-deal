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
import { criarClienteDoCadastroOnline } from "@/features/cadastros/services/cadastro-online-cliente.server";
import { conferirNomeNaCpfHub } from "@/features/cadastros/services/cpfhub-nome.server";

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
 *   5. procura o documento em `clientes` e, PENDENTE, na propria fila
 *   6. Receita (so CNPJ) ou CPFHub (so CPF) — so aqui
 *   7. CNPJ: cria o cliente e grava a fila como APROVADO.
 *      CPF (desde 29/09/2026): NAO cria cliente; grava a fila como PENDENTE,
 *      com o sinal "nome confere" da CPFHub, e o atendente aprova.
 *
 * A Receita e a CPFHub sao o passo 6 porque sao o que custa dinheiro e cota.
 * Chama-las antes do rate limit ou do honeypot deixaria qualquer robo queimar o
 * orcamento da casa. Documento repetido tambem nao chega la: o passo 5 corta
 * antes.
 *
 * A CPFHub devolve o nome do CPF; ele NAO e gravado nem devolvido. So o sinal
 * (confere / nao confere / nao verificado) vai para a fila, para o atendente. A
 * resposta da pagina e a mesma nos tres casos — e o piso de tempo cobre a
 * chamada, como cobre a Receita.
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

  // Um envio PENDENTE com o mesmo documento ja esta na fila (desde 30/09/2026):
  // NAO grava outro. A resposta e a MESMA do envio bom, de proposito — dizer
  // "ja existe" contaria a quem sonda que este documento foi enviado por
  // alguem. `documento_digitos` e coluna gerada com indice proprio.
  const { data: pendente, error: erroPendente } = await service
    .from("cadastros_online")
    .select("id")
    .eq("documento_digitos", digitos)
    .eq("status", "PENDENTE")
    .limit(1)
    .maybeSingle();

  if (erroPendente) {
    console.error("[cadastro-online] busca de pendente na fila falhou:", erroPendente.message);
    await esperarPiso(inicio);
    return NextResponse.json(
      { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel enviar agora. Tente de novo em instantes." },
      { status: 500 }
    );
  }

  if (pendente) {
    await esperarPiso(inicio);
    return NextResponse.json(RESPOSTA_RECEBIDO);
  }

  // --------------------------------------------------- 6. RECEITA ou CPFHUB
  // So aqui: depois do honeypot, do rate limit, do token, do digito verificador
  // e da duplicidade (em `clientes` e na fila).
  //
  // CNPJ: a consulta do ENVIO continua sendo a validacao final, pelo cache
  // compartilhado — quando o formulario acabou de preencher os campos com este
  // mesmo CNPJ, o dado ja esta em memoria e o envio nao gasta uma segunda das 3
  // chamadas por minuto que a casa inteira divide.
  //
  // CPF: a CPFHub responde o nome do CPF, e a unica coisa que sobrevive e o
  // sinal de conferencia com o nome digitado. Nem o nome da API nem o sinal
  // chegam a pagina. Falha na CPFHub vira `null` e o envio segue.
  const consulta =
    tipoPessoa === "JURIDICA" ? await consultarReceitaCnpj(digitos, RECEITA_TIMEOUT_MS) : null;
  const receita = consulta?.estado === "OK" ? consulta.dados : null;
  const cpfNomeConfere = tipoPessoa === "FISICA" ? await conferirNomeNaCpfHub(digitos, nome) : null;

  // ------------------------------------------------- 7. CLIENTE (so CNPJ) E FILA
  const emailInformado = textoOuNulo(corpo.email);
  const whatsappInformado = textoOuNulo(corpo.whatsapp);

  // CNPJ cria o cliente na hora, como sempre. CPF nao: nasce PENDENTE na fila
  // e so vira cliente quando o atendente aprova (rota /api/cadastro-online/aprovar,
  // que usa a mesma funcao de criacao).
  let idCliente: number | null = null;
  if (tipoPessoa === "JURIDICA") {
    const criacao = await criarClienteDoCadastroOnline(service, {
      tipoPessoa,
      documentoDigitos: digitos,
      nome,
      fantasia: textoOuNulo(corpo.fantasia),
      email: emailInformado,
      whatsapp: whatsappInformado,
      telefoneFixo: textoOuNulo(corpo.telefoneFixo),
      cep: textoOuNulo(corpo.cep),
      endereco: textoOuNulo(corpo.endereco),
      numero: textoOuNulo(corpo.numero),
      complemento: textoOuNulo(corpo.complemento),
      bairro: textoOuNulo(corpo.bairro),
      cidade: textoOuNulo(corpo.cidade),
      uf: textoOuNulo(corpo.uf),
      idVendedor: link.id_vendedor ?? null,
      nomeVendedor: textoOuNulo(link.primeiro_nome),
      receita
    });
    if (!criacao.ok) {
      await esperarPiso(inicio);
      return NextResponse.json(
        { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel concluir o cadastro. Tente de novo em instantes." },
        { status: 500 }
      );
    }
    idCliente = criacao.idCliente;
  }
  const numeroValido = idCliente !== null;

  // CNPJ: a linha da fila nasce APROVADO, com `aprovado_por` NULO — nulo e o
  // registro de que ninguem decidiu: foi automatico. A constraint
  // `cadastros_online_aprovado_coerente` exige `aprovado_em` e `id_cliente_gerado`
  // junto do status APROVADO, e e por isso que a linha e gravada DEPOIS do
  // insert em `clientes`, nunca antes.
  // CPF: nasce PENDENTE (sem `aprovado_em`, sem `id_cliente_gerado`), com o
  // sinal da CPFHub em `cpf_nome_confere`.
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
    ip_hash: hashIpCadastro(ip),
    cpf_nome_confere: cpfNomeConfere
  });

  if (erroFila) {
    if (numeroValido) {
      // O cliente EXISTE. Falhar a resposta agora faria a pessoa reenviar e
      // criar o segundo cadastro. Registra o rastro perdido e confirma.
      console.error(
        `[cadastro-online] cliente ${idCliente} criado, mas a linha da fila nao gravou:`,
        erroFila.message
      );
    } else {
      // CPF: sem a linha da fila nao existe cadastro nenhum. Aqui a pessoa
      // PRECISA tentar de novo — nada foi criado, nao ha duplicidade a temer.
      console.error("[cadastro-online] fila (CPF, PENDENTE) nao gravou:", erroFila.message);
      await esperarPiso(inicio);
      return NextResponse.json(
        { ok: false, situacao: "ERRO", mensagem: "Nao foi possivel enviar agora. Tente de novo em instantes." },
        { status: 500 }
      );
    }
  }

  await registrarUsoDoLink(service, token);

  await esperarPiso(inicio);
  // Nem `id_cliente`, nem nome oficial, nem nada que a pessoa nao tenha digitado.
  return NextResponse.json(RESPOSTA_RECEBIDO);
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
