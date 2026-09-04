/**
 * Cliente da API CWS dos Correios (prepostagem + rótulo). SERVER-ONLY.
 *
 * Contrato validado via WebFetch/WebSearch em 15/08/2026 contra fontes públicas
 * (o Swagger oficial em cws.correios.com.br exige login CAS — não é acessível
 * sem credenciais do dono). Fontes cruzadas:
 *  - https://github.com/danielbfs/correios-api-toolkit/blob/main/docs/api-correios-token.md
 *  - https://github.com/danielbfs/correios-api-toolkit/blob/main/docs/api-correios-prepostagem.md
 *  - https://www.correios.com.br/atendimento/developers/manuais/manual-uso-da-api-token
 *  - https://www.correios.com.br/atendimento/developers/manuais/manual-correios-web-service-cws
 * Confirmado (paths, métodos, nomes de campo de request/response batem com a brief):
 *  - Bases produção/homologação; POST {base}/token/v1/autentica/cartaopostagem
 *    (Basic usuario:codigoAcesso, body {numero}) → { token };
 *  - POST {base}/prepostagem/v1/prepostagens → { id, codigoObjeto };
 *  - POST {base}/prepostagem/v1/prepostagens/rotulo/assincrono/pdf
 *    body { idsPrePostagem, tipoRotulo, formatoRotulo };
 *  - GET {base}/prepostagem/v1/prepostagens/rotulo/download/assincrono/{idRecibo}
 *    → { dados } (PDF em base64).
 * EVIDÊNCIA REAL (16/08/2026) — substitui as suposições da validação anterior.
 * Duas pré-postagens foram criadas de fato em PRODUÇÃO com o payload abaixo,
 * pelo fluxo n8n "Correios - Emissão de Etiquetas":
 *   AD802864385BR (Ideal Gráfica, cartão …6812) e AD802865749BR (E3, cartão …6696).
 * Por isso o payload daqui foi alinhado ao que comprovadamente passou:
 *  - `cienteObjetoNaoProibido: "1"` — a leitura anterior ("S", inferida de fonte
 *    secundária) nunca foi exercida contra a API; "1" foi;
 *  - `numeroCartaoPostagem` e `numeroContrato` presentes;
 *  - `solicitarColeta: "N"` e `itensDeclaracaoConteudo` presentes — este último
 *    estava de fora por não se saber a estrutura interna, que agora é conhecida
 *    ({ conteudo, quantidade, valor });
 *  - `modalidadePagamento` REMOVIDO: não existia no payload aprovado, e campo
 *    extra é candidato a 400.
 * Credenciais: .env.local, por empresa (CORREIOS_<empresas.id>_*).
 * O dono replica na Vercel quando publicar.
 */

import { chaveEvento } from "./eventos";

const BASES: Record<string, string> = {
  producao: "https://api.correios.com.br",
  homologacao: "https://apihom.correios.com.br"
};

type CwsConfig = {
  base: string;
  ambiente: "producao" | "homologacao";
  idEmpresa: number | null;
  usuario: string;
  codigoAcesso: string;
  /** Token pronto, quando cadastrado no lugar de usuario+codigoAcesso. */
  token: string;
  cartaoPostagem: string;
  contrato: string;
  servicoSedex: string;
  servicoPac: string;
};

/**
 * Credenciais por empresa: cartão de postagem e contrato são POR CNPJ, e as três
 * empresas do grupo têm contratos distintos. `CORREIOS_<id>_*` (id = empresas.id)
 * tem prioridade; as variáveis sem sufixo continuam valendo como padrão, para não
 * quebrar ambiente já configurado no formato antigo.
 */
function lerVar(idEmpresa: number | null, sufixo: string): string {
  const especifica = idEmpresa ? process.env[`CORREIOS_${idEmpresa}_${sufixo}`] : "";
  return String(especifica || process.env[`CORREIOS_${sufixo}`] || "").trim();
}

/** Ids de empresa com cartão cadastrado — usado só pelo status sem empresa definida. */
function empresasConfiguradas(): number[] {
  return Object.keys(process.env)
    .map((k) => /^CORREIOS_(\d+)_CARTAO_POSTAGEM$/.exec(k))
    .filter((m): m is RegExpExecArray => Boolean(m) && Boolean(process.env[m![0]]?.trim()))
    .map((m) => Number(m[1]));
}

export function lerConfigCorreios(idEmpresa?: number | null): CwsConfig | null {
  const ambiente = (process.env.CORREIOS_AMBIENTE || "").trim() as CwsConfig["ambiente"];
  if (!BASES[ambiente]) return null;

  const id = idEmpresa && idEmpresa > 0 ? idEmpresa : null;
  const cartaoPostagem = lerVar(id, "CARTAO_POSTAGEM");
  const usuario = lerVar(id, "USUARIO");

  // Token pronto (cws-…) e código de acesso são coisas diferentes e já foram
  // confundidos no cadastro: aceita o token tanto em CORREIOS_<id>_TOKEN quanto
  // em CODIGO_ACESSO, reconhecendo pelo prefixo. Com código de acesso real, o
  // token é renovado a cada operação — que é o comportamento desejável, porque
  // token CWS é de curta duração.
  const segredo = lerVar(id, "CODIGO_ACESSO");
  const pareceToken = segredo.startsWith("cws-");
  const token = lerVar(id, "TOKEN") || (pareceToken ? segredo : "");
  const codigoAcesso = pareceToken ? "" : segredo;

  if (!cartaoPostagem) return null;
  if (!token && !(usuario && codigoAcesso)) return null;

  return {
    base: BASES[ambiente],
    ambiente,
    idEmpresa: id,
    usuario,
    codigoAcesso,
    token,
    cartaoPostagem,
    contrato: lerVar(id, "CONTRATO"),
    servicoSedex: (process.env.CORREIOS_SERVICO_SEDEX || "03220").trim(),
    servicoPac: (process.env.CORREIOS_SERVICO_PAC || "03298").trim()
  };
}

/** Sem empresa definida, responde se ALGUMA está configurada (usado pelo status da tela). */
export function correiosConfigurado(idEmpresa?: number | null): boolean {
  if (idEmpresa && idEmpresa > 0) return lerConfigCorreios(idEmpresa) !== null;
  if (lerConfigCorreios() !== null) return true;
  return empresasConfiguradas().some((id) => lerConfigCorreios(id) !== null);
}

class CorreiosApiError extends Error {
  // Campo declarado e atribuído à mão, não via parameter property: o runner de
  // testes do projeto (`node --experimental-strip-types`) só remove tipos e
  // recusa `constructor(public status: ...)`, o que tornava este módulo inteiro
  // impossível de carregar num teste. Comportamento idêntico.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CorreiosApiError";
  }
}

/**
 * Contato para o payload dos Correios.
 *
 * O par de campos depende do TIPO de número, não é um só: `celular` é validado
 * com 9 dígitos e `telefone` com 8. Mandar um celular (9 dígitos) no campo
 * `telefone` volta como "Telefone do destinatário invalido" — foi exatamente o
 * erro visto na primeira emissão pela tela, e o mesmo que já havia sido
 * resolvido no fluxo n8n, que manda `dddCelular`/`celular`.
 *
 * Campo ausente em vez de string vazia: 3 das 4 empresas reais em
 * public.empresas têm telefone_nfe NULL, e destinatário sem whatsapp/telefone
 * cadastrado também chega aqui vazio — mandar "" tem boa chance de virar 400.
 * Número com tamanho fora do padrão brasileiro é omitido pelo mesmo motivo.
 */
// Exportada em 04/09/2026 so para o teste da regra de telefone da prepostagem
// (`scripts/testes/etiqueta-apresentacao.test.mts`) — nenhum outro chamador.
export function contatoParaPayload(bruto: string): Record<string, string> {
  const limpo = bruto.replace(/\D/g, "");
  if (limpo.length < 10) return {};
  const ddd = limpo.slice(0, 2);
  const numero = limpo.slice(2);
  if (numero.length === 9) return { dddCelular: ddd, celular: numero };
  if (numero.length === 8) return { dddTelefone: ddd, telefone: numero };
  return {};
}

async function lerErro(response: Response): Promise<string> {
  try {
    const body = await response.json();
    // A API devolve msgs em formatos variados; concatena o que achar.
    const msgs = [body?.mensagem, body?.msg, ...(Array.isArray(body?.msgs) ? body.msgs : [])]
      .filter(Boolean)
      .join(" | ");
    return msgs || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** Token do cartão de postagem (JWT, dura horas — sem cache nesta fase: 1 chamada por operação). */
async function obterToken(cfg: CwsConfig): Promise<string> {
  // Token cadastrado direto: usa como está. Expira em horas e o dono precisa
  // trocar à mão — cadastrar o código de acesso elimina essa manutenção.
  if (cfg.token) return cfg.token;

  const basic = Buffer.from(`${cfg.usuario}:${cfg.codigoAcesso}`).toString("base64");
  const response = await fetch(`${cfg.base}/token/v1/autentica/cartaopostagem`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({ numero: cfg.cartaoPostagem })
  });
  if (!response.ok) throw new CorreiosApiError(response.status, `Autenticação Correios: ${await lerErro(response)}`);
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new CorreiosApiError(500, "Autenticação Correios: resposta sem token.");
  return data.token;
}

export type CwsPrepostagemInput = {
  servico: "SEDEX" | "PAC";
  /** empresas.id do remetente — escolhe cartão de postagem e credencial. */
  idEmpresa: number | null;
  pesoGramas: number;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  remetente: {
    nome: string; cep: string; logradouro: string; numero: string; complemento: string;
    bairro: string; cidade: string; uf: string; telefone: string; cnpj: string;
  };
  destinatario: {
    nome: string; cep: string; logradouro: string; numero: string; complemento: string;
    bairro: string; cidade: string; uf: string; telefone: string;
  };
  /** Declaração de conteúdo. Sem itens, vai um genérico de material gráfico. */
  itensDeclaracao?: Array<{ conteudo: string; quantidade: string; valor: string }>;
};

export async function criarPrepostagem(
  input: CwsPrepostagemInput
): Promise<{ id: string; codigoObjeto: string }> {
  const cfg = lerConfigCorreios(input.idEmpresa);
  if (!cfg) {
    throw new CorreiosApiError(
      500,
      `Credenciais dos Correios não configuradas para a empresa ${input.idEmpresa ?? "(padrão)"}.`
    );
  }
  const token = await obterToken(cfg);

  const payload = {
    codigoServico: input.servico === "SEDEX" ? cfg.servicoSedex : cfg.servicoPac,
    remetente: {
      nome: input.remetente.nome,
      cpfCnpj: input.remetente.cnpj.replace(/\D/g, ""),
      ...contatoParaPayload(input.remetente.telefone),
      endereco: {
        cep: input.remetente.cep.replace(/\D/g, ""),
        logradouro: input.remetente.logradouro,
        numero: input.remetente.numero || "S/N",
        complemento: input.remetente.complemento,
        bairro: input.remetente.bairro,
        cidade: input.remetente.cidade,
        uf: input.remetente.uf
      }
    },
    destinatario: {
      nome: input.destinatario.nome,
      ...contatoParaPayload(input.destinatario.telefone),
      endereco: {
        cep: input.destinatario.cep.replace(/\D/g, ""),
        logradouro: input.destinatario.logradouro,
        numero: input.destinatario.numero || "S/N",
        complemento: input.destinatario.complemento,
        bairro: input.destinatario.bairro,
        cidade: input.destinatario.cidade,
        uf: input.destinatario.uf
      }
    },
    numeroCartaoPostagem: cfg.cartaoPostagem,
    ...(cfg.contrato ? { numeroContrato: cfg.contrato } : {}),
    codigoFormatoObjetoInformado: "2",
    pesoInformado: String(Math.max(1, Math.round(input.pesoGramas))),
    alturaInformada: String(Math.max(1, Math.round(input.alturaCm))),
    larguraInformada: String(Math.max(1, Math.round(input.larguraCm))),
    // "1", não "S": ver nota de EVIDÊNCIA REAL no topo do arquivo.
    cienteObjetoNaoProibido: "1",
    solicitarColeta: "N",
    comprimentoInformado: String(Math.max(1, Math.round(input.comprimentoCm))),
    itensDeclaracaoConteudo: input.itensDeclaracao?.length
      ? input.itensDeclaracao
      : [{ conteudo: "Material grafico", quantidade: "1", valor: "0.00" }]
  };

  const response = await fetch(`${cfg.base}/prepostagem/v1/prepostagens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new CorreiosApiError(response.status, `Prepostagem: ${await lerErro(response)}`);
  const data = (await response.json()) as { id?: string; codigoObjeto?: string };
  if (!data.id || !data.codigoObjeto) throw new CorreiosApiError(500, "Prepostagem: resposta sem id/codigoObjeto.");
  return { id: String(data.id), codigoObjeto: String(data.codigoObjeto) };
}

/** Solicita o rótulo (assíncrono) e baixa o PDF pronto para térmica (formato ET). */
export async function baixarRotuloPdf(idPrepostagem: string, idEmpresa?: number | null): Promise<Buffer> {
  // Mesma empresa que criou a pré-postagem: o rótulo só é acessível pelo cartão
  // que a emitiu. Resolver a empresa diferente daqui daria 403/404 dos Correios.
  const cfg = lerConfigCorreios(idEmpresa);
  if (!cfg) {
    throw new CorreiosApiError(
      500,
      `Credenciais dos Correios não configuradas para a empresa ${idEmpresa ?? "(padrão)"}.`
    );
  }
  const token = await obterToken(cfg);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const solicitar = await fetch(`${cfg.base}/prepostagem/v1/prepostagens/rotulo/assincrono/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify({ idsPrePostagem: [idPrepostagem], tipoRotulo: "P", formatoRotulo: "ET" })
  });
  if (!solicitar.ok) throw new CorreiosApiError(solicitar.status, `Rótulo (solicitação): ${await lerErro(solicitar)}`);
  const { idRecibo } = (await solicitar.json()) as { idRecibo?: string };
  if (!idRecibo) throw new CorreiosApiError(500, "Rótulo: resposta sem idRecibo.");

  // Poll curto: o PDF costuma ficar pronto em segundos.
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    await new Promise((r) => setTimeout(r, tentativa === 0 ? 800 : 1500));
    const download = await fetch(
      `${cfg.base}/prepostagem/v1/prepostagens/rotulo/download/assincrono/${idRecibo}`,
      { headers }
    );
    if (download.status === 200) {
      const body = (await download.json()) as { dados?: string; nome?: string };
      if (body.dados) return Buffer.from(body.dados, "base64");
      throw new CorreiosApiError(500, "Rótulo: download sem campo de dados.");
    }
    if (download.status !== 202 && download.status !== 404) {
      throw new CorreiosApiError(download.status, `Rótulo (download): ${await lerErro(download)}`);
    }
  }
  throw new CorreiosApiError(504, "Rótulo: tempo esgotado aguardando o PDF dos Correios.");
}

// ─── Rastreio (srorastro) ────────────────────────────────────────────────────

/**
 * Ids de empresa com credencial capaz de rastrear, em ordem crescente.
 *
 * Existe porque a consulta precisa varrer contratos: o objeto só aparece para a
 * empresa dona dele, e nem sempre a empresa da proposta é quem postou (pedido
 * antigo, etiqueta emitida por outra unidade). Sem a varredura, um caso desses
 * viraria "não encontrado" sem explicação.
 */
export function empresasComRastro(): number[] {
  const ids = new Set<number>();
  for (const chave of Object.keys(process.env)) {
    const m = /^CORREIOS_(\d+)_(RASTRO|CODIGO_ACESSO)$/.exec(chave);
    if (m && String(process.env[chave] ?? "").trim()) ids.add(Number(m[1]));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export type CwsEventoRastro = {
  /** Par codigo-tipo ("BDE-1"), como em lib/correios/eventos.ts. */
  chave: string;
  descricao: string;
  detalhe: string | null;
  /** ISO local devolvido pela API ("2026-08-19T11:58:55"). */
  dataHora: string | null;
  local: string | null;
};

export type CwsRastroObjeto = {
  codigo: string;
  categoria: string | null;
  eventos: CwsEventoRastro[];
};

export type CwsRastroResultado =
  /** O objeto pertence a este contrato e veio com dados. */
  | { situacao: "encontrado"; objeto: CwsRastroObjeto }
  /** Autenticou, mas o objeto é de outro contrato (SRO-009) ou não existe. */
  | { situacao: "outro_contrato"; mensagem: string }
  /** Empresa sem credencial de rastreio no ambiente. */
  | { situacao: "sem_credencial" }
  /** Erro real (rede, permissão da chave, indisponibilidade). */
  | { situacao: "erro"; status: number; mensagem: string };

/** Endereço do evento vira "CIDADE/UF" — a API só traz `uf` quando é interno. */
function localDoEvento(unidade: unknown): string | null {
  const u = unidade as { endereco?: { cidade?: string; uf?: string }; nome?: string } | undefined;
  const cidade = u?.endereco?.cidade?.trim() ?? "";
  const uf = u?.endereco?.uf?.trim() ?? "";
  if (cidade && uf) return `${cidade}/${uf}`;
  return cidade || uf || null;
}

/**
 * Consulta UM objeto no contrato de UMA empresa.
 *
 * A API do SRO só devolve objetos do contrato dono da chave: consultar o objeto
 * de outra empresa responde `200` com `SRO-009: Objeto não pertence ao
 * contrato` dentro do corpo — não é erro de credencial, e por isso tem situação
 * própria. Foi exatamente esse caso que fez o rastreio da Birô parecer quebrado
 * enquanto o fluxo externo usava uma credencial só.
 *
 * O idioma vai no HEADER `Accept-Language`; como query param a API recusa com
 * `SRO-018`, mesmo recebendo `pt-BR`.
 */
export async function rastrearObjetoCorreios(
  codigo: string,
  idEmpresa: number | null
): Promise<CwsRastroResultado> {
  const ambiente = (process.env.CORREIOS_AMBIENTE || "").trim();
  const base = BASES[ambiente];
  if (!base) return { situacao: "sem_credencial" };

  // Chave dedicada de rastreio quando houver; senão a mesma credencial do resto.
  const chave = lerVar(idEmpresa, "RASTRO") || lerVar(idEmpresa, "CODIGO_ACESSO");
  if (!chave) return { situacao: "sem_credencial" };

  const alvo = `${base}/srorastro/v1/objetos/${encodeURIComponent(codigo)}?resultado=T`;
  let response: Response;
  try {
    response = await fetch(alvo, {
      headers: { Authorization: `Bearer ${chave}`, "Accept-Language": "pt-BR" }
    });
  } catch (e) {
    return { situacao: "erro", status: 0, mensagem: e instanceof Error ? e.message : "Falha de rede." };
  }

  if (!response.ok) {
    return { situacao: "erro", status: response.status, mensagem: await lerErro(response) };
  }

  const corpo = (await response.json().catch(() => null)) as {
    objetos?: Array<{
      codObjeto?: string;
      mensagem?: string;
      tipoPostal?: { categoria?: string };
      eventos?: Array<{
        codigo?: string;
        tipo?: string;
        descricao?: string;
        detalhe?: string;
        dtHrCriado?: string;
        unidade?: unknown;
      }>;
    }>;
  } | null;

  const objeto = corpo?.objetos?.[0];
  if (!objeto) return { situacao: "erro", status: 502, mensagem: "Correios responderam sem o objeto." };
  // `mensagem` no lugar dos eventos é a forma da API dizer que não tem o dado.
  if (objeto.mensagem) return { situacao: "outro_contrato", mensagem: objeto.mensagem };

  return {
    situacao: "encontrado",
    objeto: {
      codigo: objeto.codObjeto ?? codigo,
      categoria: objeto.tipoPostal?.categoria ?? null,
      eventos: (objeto.eventos ?? []).map((ev) => ({
        chave: chaveEvento(ev.codigo, ev.tipo),
        descricao: (ev.descricao ?? "").trim(),
        detalhe: (ev.detalhe ?? "").trim() || null,
        dataHora: ev.dtHrCriado ?? null,
        local: localDoEvento(ev.unidade)
      }))
    }
  };
}
