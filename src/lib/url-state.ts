/**
 * Estado de tela na URL — leitura e escrita de filtros em query params.
 *
 * Camada pura (sem React) usada pelo hook `useUrlFilters`. Cada parâmetro é
 * descrito por um codec, responsável por interpretar o texto vindo da URL e por
 * devolvê-lo ao formato de link. Duas regras valem para todos os codecs:
 *
 * - valor ausente ou inválido nunca quebra a tela: cai no padrão declarado;
 * - valor igual ao padrão não aparece na URL, para o link ficar limpo.
 */

export type ParamCodec<T> = {
  /** Interpreta o texto da URL. `undefined` significa ausente ou inválido. */
  parse: (bruto: string | null) => T | undefined;
  /** Converte para a URL. `null` remove o parâmetro. */
  serialize: (valor: T) => string | null;
};

export type FiltroSpec<T> = {
  codec: ParamCodec<T>;
  /** Valor assumido quando o parâmetro está ausente ou inválido. Nunca vai para a URL. */
  default: T;
  /** Nomes antigos aceitos apenas na leitura, para não quebrar links já compartilhados. */
  alias?: readonly string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- o schema mistura codecs de tipos diferentes; cada chave preserva seu tipo em `ValoresDe`. */
export type UrlFiltersSchema = Record<string, FiltroSpec<any>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ValoresDe<S extends UrlFiltersSchema> = {
  [K in keyof S]: S[K] extends FiltroSpec<infer T> ? T : never;
};

function textoLimpo(bruto: string | null): string | undefined {
  if (bruto === null) return undefined;
  const valor = bruto.trim();
  return valor === "" ? undefined : valor;
}

export const codecs = {
  /** Texto livre (busca, por exemplo). */
  texto(): ParamCodec<string> {
    return {
      parse: (bruto) => textoLimpo(bruto),
      serialize: (valor) => (valor.trim() === "" ? null : valor.trim())
    };
  },

  /** Número inteiro, com faixa opcional. Fora da faixa é tratado como inválido. */
  numero(opcoes?: { min?: number; max?: number }): ParamCodec<number> {
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === undefined) return undefined;
        const numero = Number(valor);
        if (!Number.isInteger(numero)) return undefined;
        if (opcoes?.min !== undefined && numero < opcoes.min) return undefined;
        if (opcoes?.max !== undefined && numero > opcoes.max) return undefined;
        return numero;
      },
      serialize: (valor) => String(valor)
    };
  },

  /** Booleano representado por "1" e "0". */
  booleano(): ParamCodec<boolean> {
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === "1") return true;
        if (valor === "0") return false;
        return undefined;
      },
      serialize: (valor) => (valor ? "1" : "0")
    };
  },

  /** Lista fechada de valores. Qualquer coisa fora da lista cai no padrão. */
  enumOf<const V extends readonly string[]>(valores: V): ParamCodec<V[number]> {
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === undefined) return undefined;
        return (valores as readonly string[]).includes(valor) ? (valor as V[number]) : undefined;
      },
      serialize: (valor) => valor
    };
  },

  /** Data no formato AAAA-MM-DD. Texto vazio significa "sem data". */
  dataIso(): ParamCodec<string> {
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === undefined) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
        const data = new Date(`${valor}T00:00:00`);
        return Number.isNaN(data.getTime()) ? undefined : valor;
      },
      serialize: (valor) => (valor === "" ? null : valor)
    };
  },

  /**
   * Data AAAA-MM-DD ou "sem data" declarado explicitamente.
   *
   * Diferente de `dataIso`, aqui o vazio é um valor com significado ("todas as
   * datas") e precisa aparecer na URL — senão um link sem período seria
   * indistinguível de um link que apenas omitiu o parâmetro e cairia no padrão.
   */
  dataIsoOuTodas(sentinela: string = "todas"): ParamCodec<string> {
    const data = codecs.dataIso();
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === sentinela) return "";
        return data.parse(bruto);
      },
      serialize: (valor) => (valor === "" ? sentinela : valor)
    };
  },

  /** Mês no formato AAAA-MM. */
  mesIso(): ParamCodec<string> {
    return {
      parse: (bruto) => {
        const valor = textoLimpo(bruto);
        if (valor === undefined) return undefined;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return undefined;
        return valor;
      },
      serialize: (valor) => (valor === "" ? null : valor)
    };
  }
};

/** Lê os valores do schema a partir dos parâmetros da URL, aplicando padrões e apelidos. */
export function parseSearchParams<S extends UrlFiltersSchema>(
  schema: S,
  params: URLSearchParams
): ValoresDe<S> {
  const valores = {} as ValoresDe<S>;

  for (const chave of Object.keys(schema)) {
    const spec = schema[chave];
    let interpretado = spec.codec.parse(params.get(chave));

    if (interpretado === undefined && spec.alias) {
      for (const apelido of spec.alias) {
        interpretado = spec.codec.parse(params.get(apelido));
        if (interpretado !== undefined) break;
      }
    }

    valores[chave as keyof S] = (interpretado === undefined ? spec.default : interpretado) as ValoresDe<S>[keyof S];
  }

  return valores;
}

/**
 * Monta a query string aplicando os valores do schema sobre os parâmetros atuais.
 *
 * Parâmetros fora do schema são preservados (ex.: `id_int`). Valores iguais ao
 * padrão e apelidos antigos são removidos, para o link refletir só o que foge do
 * padrão e existir uma única grafia por filtro.
 */
export function buildSearchString<S extends UrlFiltersSchema>(
  schema: S,
  valores: Partial<ValoresDe<S>>,
  searchAtual: string
): string {
  const params = new URLSearchParams(searchAtual);

  for (const chave of Object.keys(schema)) {
    if (!(chave in valores)) continue;

    const spec = schema[chave];
    const valor = valores[chave as keyof S];

    for (const apelido of spec.alias ?? []) {
      params.delete(apelido);
    }

    const ehPadrao = JSON.stringify(valor) === JSON.stringify(spec.default);
    const serializado = ehPadrao || valor === undefined ? null : spec.codec.serialize(valor);

    if (serializado === null) {
      params.delete(chave);
    } else {
      params.set(chave, serializado);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
