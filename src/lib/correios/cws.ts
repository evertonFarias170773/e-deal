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
  constructor(public status: number, message: string) {
    super(message);
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
function contatoParaPayload(bruto: string): Record<string, string> {
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
