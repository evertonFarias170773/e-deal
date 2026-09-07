import { fetchJsonWithTimeout } from "@/lib/http/fetch-json-timeout";

/**
 * Consulta de CNPJ na Receita, server-only, com cache.
 *
 * A API E A MESMA QUE O CADASTRO INTERNO JA USA: `publica.cnpj.ws`, sem chave e
 * sem cobranca por chamada. Nao ha servico novo nem contrato novo aqui — este
 * arquivo so passou a ser o lugar unico de onde ela e chamada, porque agora ha
 * dois caminhos precisando dela (o envio e o preenchimento do formulario) e
 * duplicar a chamada dobraria o consumo de uma cota que ja e minuscula.
 *
 * A COTA, MEDIDA EM 07/09/2026
 * ----------------------------
 * Tres chamadas em sequencia respondem 200. A QUARTA responde:
 *
 *   HTTP 429  {"titulo":"Muitas requisicoes",
 *              "detalhes":"Excedido o limite maximo de 3 consultas por minuto..."}
 *   retry-after: 60
 *
 * TRES POR MINUTO, POR IP — e o IP e o DO SERVIDOR, nao o do visitante. Ou seja,
 * o teto e da casa inteira: a tela interna de cadastro, o formulario publico e a
 * validacao do envio dividem as mesmas 3 por minuto. Dois atendentes digitando
 * CNPJ ao mesmo tempo ja se atrapalham entre si, e isso vale desde antes deste
 * arquivo existir.
 *
 * POR QUE O CACHE NAO E OTIMIZACAO PREMATURA
 * ------------------------------------------
 * Sem ele, um unico cadastro online custa DUAS chamadas: uma quando o cliente
 * digita o CNPJ e o formulario preenche, outra quando ele envia e o servidor
 * revalida. Duas de tres por minuto, para um cadastro so. Com o cache, o envio
 * reaproveita o que o formulario acabou de buscar e o custo cai para uma.
 *
 * A validacao do envio CONTINUA existindo — ela so deixa de repetir uma chamada
 * que acabou de ser feita. Dado de Receita muda em escala de meses; dez minutos
 * de cache nao mudam desfecho nenhum.
 *
 * Cache em memoria, por instancia do Next. Numa plataforma com varias instancias
 * o acerto e menor, mas nunca ha resposta errada: o pior caso e repetir a
 * chamada, que e o comportamento de antes.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRADAS = 500;

export type ReceitaCnpj = {
  razaoSocial: string;
  fantasia: string;
  dataFundacao: string | null;
  telefoneFixo: string;
  email: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cidadeUf: string;
  insEstadual: string;
  /** Codigo da SEFAZ: "1" contribuinte de ICMS, "9" nao contribuinte. */
  tipoContribuinte: string;
};

export type ResultadoReceita =
  | { estado: "OK"; dados: ReceitaCnpj }
  | { estado: "NAO_ENCONTRADO" }
  | { estado: "INDISPONIVEL" };

type RespostaCnpjWs = {
  razao_social?: string;
  estabelecimento?: {
    nome_fantasia?: string;
    data_inicio_atividade?: string;
    email?: string;
    ddd1?: string;
    telefone1?: string;
    cep?: string;
    tipo_logradouro?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: { nome?: string };
    estado?: { sigla?: string };
    inscricoes_estaduais?: Array<{ ativo?: boolean; situacao?: string; inscricao_estadual?: string }>;
  };
};

const cache = new Map<string, { em: number; resultado: ResultadoReceita }>();

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function dataIso(valor: string): string | null {
  const achado = texto(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return achado ? `${achado[1]}-${achado[2]}-${achado[3]}` : null;
}

function guardar(digitos: string, resultado: ResultadoReceita) {
  if (cache.size >= MAX_ENTRADAS) {
    const agora = Date.now();
    for (const [chave, valor] of cache) {
      if (agora - valor.em > TTL_MS) cache.delete(chave);
    }
    if (cache.size >= MAX_ENTRADAS) cache.clear();
  }
  cache.set(digitos, { em: Date.now(), resultado });
}

/**
 * `INDISPONIVEL` (timeout, rede, 429) NAO e guardado: e transitorio, e cachear
 * uma indisponibilidade de rede manteria o erro vivo por dez minutos depois de
 * a API ter voltado. `NAO_ENCONTRADO` e guardado — CNPJ que nao existe segue
 * nao existindo.
 */
export async function consultarReceitaCnpj(
  digitos: string,
  timeoutMs: number
): Promise<ResultadoReceita> {
  const guardado = cache.get(digitos);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return guardado.resultado;
  }

  const resposta = await fetchJsonWithTimeout<RespostaCnpjWs>(
    `https://publica.cnpj.ws/cnpj/${digitos}`,
    undefined,
    timeoutMs
  );

  if (!resposta.ok) {
    if (resposta.status === 404) {
      const naoAchou: ResultadoReceita = { estado: "NAO_ENCONTRADO" };
      guardar(digitos, naoAchou);
      return naoAchou;
    }
    if (resposta.status === 429) {
      console.warn("[receita-cnpj] 429 da publica.cnpj.ws — teto de 3 por minuto, por IP do servidor.");
    }
    return { estado: "INDISPONIVEL" };
  }

  const est = resposta.data.estabelecimento ?? {};
  const cidade = texto(est.cidade?.nome);
  const uf = texto(est.estado?.sigla).toUpperCase();
  const inscricao = (est.inscricoes_estaduais ?? []).find(
    (item) => item?.ativo === true || texto(item?.situacao).toLowerCase() === "ativa"
  );
  const insEstadual = texto(inscricao?.inscricao_estadual);
  const logradouro = [texto(est.tipo_logradouro), texto(est.logradouro)].filter(Boolean).join(" ");

  const dados: ReceitaCnpj = {
    razaoSocial: texto(resposta.data.razao_social),
    fantasia: texto(est.nome_fantasia),
    dataFundacao: dataIso(texto(est.data_inicio_atividade)),
    telefoneFixo: `${texto(est.ddd1)}${texto(est.telefone1)}`,
    email: texto(est.email),
    cep: texto(est.cep).replace(/\D/g, ""),
    endereco: logradouro,
    numero: texto(est.numero),
    complemento: texto(est.complemento),
    bairro: texto(est.bairro),
    cidade,
    uf,
    cidadeUf: cidade && uf ? `${cidade} - ${uf}` : "",
    insEstadual,
    // Vocabulario da SEFAZ, igual ao da rota autenticada: com inscricao estadual
    // ativa e contribuinte de ICMS (1); sem ela nao da para separar isento de nao
    // contribuinte, e o padrao seguro e 9 — declarar contribuinte quem nao e
    // custa rejeicao da nota.
    tipoContribuinte: insEstadual ? "1" : "9"
  };

  const achou: ResultadoReceita = { estado: "OK", dados };
  guardar(digitos, achou);
  return achou;
}
