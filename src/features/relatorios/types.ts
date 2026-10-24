/**
 * Modelo único de relatório (24/10/2026).
 *
 * Cada relatório é um módulo em `definicoes/` que exporta UM objeto
 * `RelatorioDef` e entra na lista de `registro.ts`. A página base
 * (`ReportPage`), a rota de dados (`/api/relatorios/[slug]`) e o menu leem só
 * esse objeto: acrescentar ou alterar um relatório não mexe em outro nem na base.
 *
 * Tudo aqui é puro (sem React, sem servidor): a mesma definição roda no
 * navegador (filtros, colunas, CSV) e na rota (permissão, argumentos da RPC).
 * A soma e a agregação acontecem no banco; o navegador só ordena e exibe.
 */

export type AreaRelatorio =
  | "vendas"
  | "financeiro"
  | "producao"
  | "expedicao"
  | "produtos"
  | "infraestrutura";

export type PresetPeriodo = "hoje" | "mes" | "mes_anterior" | "custom";

export type Opcao = { valor: string; rotulo: string };

export type FiltroDef = {
  /** Nome do parâmetro na URL e no pedido à rota. */
  chave: string;
  rotulo: string;
  /** Rótulo da opção "sem filtro". */
  todasRotulo: string;
  /** Opções fixas. Com elas, a rota só aceita um desses valores. */
  opcoes?: Opcao[];
  /** Opções vindas do banco, carregadas no navegador (ex.: vendedores). */
  carregarOpcoes?: () => Promise<Opcao[]>;
};

export type TipoColuna = "texto" | "inteiro" | "moeda" | "data";

/** Linha de relatório: um registro plano, por id de coluna. */
export type LinhaRelatorio = Record<string, string | number | null>;

export type ColunaDef = {
  /** Chave do valor dentro da linha. */
  id: string;
  titulo: string;
  tipo: TipoColuna;
  /** Padrão: texto à esquerda, número/moeda à direita. */
  alinhamento?: "left" | "right" | "center";
};

export type CardResumo = {
  titulo: string;
  valor: string;
  descricao: string;
  tom?: "success" | "info" | "warning" | "danger" | "neutral";
};

/** Resultado já normalizado: o que a tela exibe. */
export type ResultadoRelatorio = {
  linhas: LinhaRelatorio[];
  /** Linha de total, por id de coluna. Vem do banco, nunca somada na tela. */
  total: Record<string, string | number | null>;
  /** De 3 a 5 cards. */
  cards: CardResumo[];
};

/** O que a rota repassa à definição depois de validar. */
export type ConsultaRelatorio = {
  inicio: string;
  fim: string;
  /** Valor de cada filtro da definição ("" = sem filtro). */
  filtros: Record<string, string>;
};

export type RelatorioDef = {
  /** Único em toda a lista; vira parte do endereço e da rota de dados. */
  slug: string;
  area: AreaRelatorio;
  titulo: string;
  descricao: string;
  /** Chave do catálogo de permissões. A rota e a página conferem a mesma. */
  permissao: string;

  /** Cabeçalho: qual data o relatório usa, escrito para quem lê. */
  dataReferencia: {
    /** Ex.: "Data do pagamento". */
    rotulo: string;
    /** O que entra e o que fica de fora, em uma ou duas frases. */
    criterio: string;
  };

  periodo: {
    presets: PresetPeriodo[];
    padrao: PresetPeriodo;
    /** Período máximo em dias (protege o banco). */
    maxDias: number;
  };

  filtros: FiltroDef[];
  colunas: ColunaDef[];
  ordenacaoPadrao: { coluna: string; direcao: "asc" | "desc" };

  /** Função do banco que devolve os dados já agregados. */
  rpc: {
    nome: string;
    argumentos: (consulta: ConsultaRelatorio) => Record<string, unknown>;
  };
  /** Transforma a resposta da RPC em linhas, total e cards. */
  normalizar: (resposta: unknown) => ResultadoRelatorio;
};

/** Dados de uma área do menu. */
export type AreaDef = {
  id: AreaRelatorio;
  rotulo: string;
  descricao: string;
};
