/**
 * O retorno da publica.cnpj.ws, traduzido UMA vez para a casa.
 *
 * POR QUE ESTE ARQUIVO EXISTE (17/09/2026)
 *   Duas rotas consultam o MESMO serviço e liam o mesmo JSON com códigos
 *   diferentes: `/api/cadastros/consultar-documento` já devolvia o endereço
 *   campo a campo e a Inscrição Estadual ativa, enquanto `/api/verificacao`
 *   (ramo CNPJ) só devolvia o endereço concatenado numa string e jogava a IE
 *   fora, embora tivesse os dois em mãos. Em vez de copiar o mapeamento uma
 *   terceira vez, ele passa a morar aqui e as duas rotas o importam.
 *
 * NADA MUDA PARA QUEM JÁ USAVA
 *   As funções abaixo são as de `consultar-documento`, movidas sem alteração
 *   de comportamento: mesma escolha de IE, mesmo `tipo_logradouro + logradouro`
 *   e mesmo CEP só com dígitos. O que a rota de verificação devolvia continua
 *   sendo devolvido; ela apenas passa a devolver TAMBÉM o que já tinha.
 */

import { normalizeDocumentDigits } from "@/features/cadastros/utils/documento";
import type { CodigoTipoContribuinte } from "@/lib/fiscal/tipo-contribuinte";

export type CnpjWsInscricaoEstadual = {
  ativo?: boolean;
  situacao?: string;
  inscricao_estadual?: string;
};

export type CnpjWsEstabelecimento = {
  cnpj?: string;
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
  inscricoes_estaduais?: CnpjWsInscricaoEstadual[];
};

export type CnpjWsResposta = {
  razao_social?: string;
  estabelecimento?: CnpjWsEstabelecimento;
};

/** Endereço do estabelecimento, campo a campo — do jeito que o formulário pede. */
export type EnderecoDoEstabelecimento = {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function mountLogradouro(tipoLogradouro: string, logradouro: string) {
  const parts = [toText(tipoLogradouro), toText(logradouro)].filter(Boolean);
  return parts.join(" ");
}

export function findInscricaoEstadualAtiva(inscricoes: CnpjWsInscricaoEstadual[] | undefined) {
  if (!Array.isArray(inscricoes)) {
    return "";
  }

  const found = inscricoes.find((item) => {
    if (item?.ativo === true) {
      return true;
    }

    return toText(item?.situacao).toLowerCase() === "ativa";
  });

  return toText(found?.inscricao_estadual);
}

export function mapearEnderecoDoEstabelecimento(
  estabelecimento: CnpjWsEstabelecimento | undefined
): EnderecoDoEstabelecimento {
  const dados = estabelecimento ?? {};

  return {
    cep: normalizeDocumentDigits(toText(dados.cep)),
    endereco: mountLogradouro(toText(dados.tipo_logradouro), toText(dados.logradouro)),
    numero: toText(dados.numero),
    complemento: toText(dados.complemento),
    bairro: toText(dados.bairro),
    cidade: toText(dados.cidade?.nome),
    uf: toText(dados.estado?.sigla).toUpperCase()
  };
}

/**
 * Código da SEFAZ desde 25/08/2026, o mesmo vocabulário da NF. Com inscrição
 * estadual ativa na Receita o CNPJ é contribuinte de ICMS (1); sem ela a
 * consulta não tem como distinguir isento (2) de não contribuinte (9), e o
 * padrão seguro é o 9 — declarar contribuinte quem não é custa rejeição.
 */
export function tipoContribuintePelaInscricao(insEstadual: string): CodigoTipoContribuinte {
  return insEstadual ? "1" : "9";
}
