/**
 * AVISO DE NOTA DE REMESSA — as regras, sem tela e sem banco (08/10/2026).
 *
 * Módulo puro (sem imports). Lido pelo selo da Fila de Faturamento, pela faixa
 * do rascunho da NF-e e pela conferência antes de faturar.
 *
 * O PROBLEMA
 *   A NF-e de venda sai SEMPRE para o endereço principal do pagador (é assim em
 *   `fn_montar_payload_nfe`, e o rascunho nasce com `end_entrega = false`).
 *   Quando o pedido é entregue em outro lugar, é preciso uma segunda nota, de
 *   remessa. Nada na Fila nem no rascunho dizia isso: o financeiro descobria na
 *   Expedição, com a venda já emitida.
 *
 * O QUE ESTE MÓDULO FAZ
 *   Compara o endereço de ENTREGA do pedido com o endereço que vai na NF-e e
 *   devolve um de três níveis. É SÓ AVISO: não bloqueia, não cria a remessa e
 *   não muda nada na emissão. A remessa continua sendo feita à mão, pela ação
 *   "Gerar nota de remessa" do menu da nota de venda, depois de autorizada.
 *
 * OS NÍVEIS
 *   FORTE  município ou UF diferentes;
 *   LEVE   mesmo município, mas CEP, número ou logradouro diferentes;
 *   NENHUM igual, retirada no balcão, endereço ausente ou incompleto, ou pedido
 *          que já tem nota de remessa.
 *
 * O QUE NÃO ENTRA NA COMPARAÇÃO: bairro e complemento. São os campos mais
 * digitados de formas diferentes, e não mudam para onde o volume vai.
 */

export type NivelDoAvisoDeRemessa = "NENHUM" | "LEVE" | "FORTE";

/** O que a comparação precisa de um endereço. Tudo opcional: o cadastro tem buracos. */
export type EnderecoParaRemessa = {
  logradouro?: string | null;
  numero?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
};

export type AvisoDeRemessa = {
  nivel: NivelDoAvisoDeRemessa;
  /** Texto curto do selo e título da faixa. Vazio em NENHUM. */
  titulo: string;
  /** A frase que explica. Vazia em NENHUM. */
  texto: string;
  /** "Rua X, 10 — Cidade/UF — CEP 00000-000", para mostrar os dois lado a lado. */
  entrega: string;
  nfe: string;
};

export const ACAO_DA_REMESSA =
  'A nota de remessa é feita à mão: depois de autorizar a nota de venda, use "Gerar nota de remessa" no menu dela.';

const SEM_AVISO: AvisoDeRemessa = { nivel: "NENHUM", titulo: "", texto: "", entrega: "", nfe: "" };

/* ------------------------------------------------------------ normalização */

const ACENTOS_DE = "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ";
const ACENTOS_PARA = "AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn";

/** Troca de acento por LISTA FECHADA — a mesma do banco, para comparar como ele compara. */
function semAcento(texto: string): string {
  let saida = "";
  for (const letra of texto) {
    const i = ACENTOS_DE.indexOf(letra);
    saida += i >= 0 ? ACENTOS_PARA[i] : letra;
  }
  return saida;
}

/**
 * A CHAVE DO MUNICÍPIO: sem acento, minúsculas, só [a-z0-9].
 *
 * É a MESMA expressão da coluna gerada `ibge_municipios.nome_chave`, usada por
 * `fn_montar_payload_nfe` e por `fn_nfse_codigo_municipio`. "Sant'Ana do
 * Livramento" e "Santana Do Livramento" dão a mesma chave.
 */
export function chaveDoMunicipio(cidade: string | null | undefined): string {
  return semAcento(String(cidade ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Só os dígitos. Serve para CEP e para o número do endereço. */
export function soDigitos(valor: string | number | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Abreviações de tipo de logradouro, já sem acento e em minúsculas. */
const TIPOS_DE_LOGRADOURO: Record<string, string> = {
  r: "rua",
  av: "avenida",
  avda: "avenida",
  aven: "avenida",
  al: "alameda",
  tv: "travessa",
  trav: "travessa",
  rod: "rodovia",
  est: "estrada",
  estr: "estrada",
  pc: "praca",
  pca: "praca",
  lgo: "largo",
  bc: "beco",
  vl: "vila"
};

/**
 * O logradouro em forma comparável: sem acento nem caixa, com a abreviação do
 * tipo expandida ("Av." e "Avenida" ficam iguais, "R." e "Rua" também) e sem
 * pontuação nem espaços.
 */
export function chaveDoLogradouro(logradouro: string | null | undefined): string {
  const palavras = semAcento(String(logradouro ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (palavras.length === 0) return "";
  palavras[0] = TIPOS_DE_LOGRADOURO[palavras[0]] ?? palavras[0];
  return palavras.join("");
}

/** O número do endereço pelos dígitos; "S/N", "sn" e vazio são o mesmo "sem número". */
function chaveDoNumero(numero: string | null | undefined): string {
  return soDigitos(numero).replace(/^0+(?=\d)/, "");
}

/** Textos que não são dado: campo vazio ou lixo de cadastro. */
function limpo(valor: string | null | undefined): string {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  const maiusculo = texto.toUpperCase();
  if (!texto || maiusculo === "NULL" || maiusculo === "UNDEFINED" || maiusculo.includes("[OBJECT OBJECT]")) return "";
  return texto;
}

/**
 * O endereço dá para comparar? Precisa de logradouro, cidade, UF de duas letras
 * e CEP de oito dígitos. Faltando qualquer um, o aviso some — comparar com
 * endereço incompleto só geraria alarme falso.
 */
export function enderecoComparavel(endereco: EnderecoParaRemessa | null | undefined): boolean {
  if (!endereco) return false;
  return (
    chaveDoLogradouro(limpo(endereco.logradouro)) !== "" &&
    chaveDoMunicipio(limpo(endereco.cidade)) !== "" &&
    /^[A-Za-z]{2}$/.test(limpo(endereco.uf)) &&
    soDigitos(limpo(endereco.cep)).length === 8
  );
}

/** "Rua X, 10 — Cidade/UF — CEP 00000-000". Sem nome e sem documento. */
export function resumoDoEndereco(endereco: EnderecoParaRemessa | null | undefined): string {
  if (!endereco) return "";
  const rua = [limpo(endereco.logradouro), limpo(endereco.numero)].filter(Boolean).join(", ");
  const cidade = cidadeUf(endereco);
  const cep = soDigitos(limpo(endereco.cep));
  return [rua, cidade, cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ""].filter(Boolean).join(" — ");
}

/** "Cidade/UF", como o resto do sistema escreve. */
export function cidadeUf(endereco: EnderecoParaRemessa | null | undefined): string {
  if (!endereco) return "";
  return [limpo(endereco.cidade), limpo(endereco.uf).toUpperCase()].filter(Boolean).join("/");
}

/* ---------------------------------------------------------------- a regra */

export type EntradaDoAvisoDeRemessa = {
  /** `propostas.modalidade_frete`: "RETIRA", "FOB", "CIF" ou nada. */
  modalidadeFrete?: string | null;
  /** O endereço de entrega vigente do pedido. */
  entrega: EnderecoParaRemessa | null | undefined;
  /** O endereço que vai na NF-e de venda: o principal do pagador. */
  nfe: EnderecoParaRemessa | null | undefined;
  /** O pedido já tem nota de remessa viva (não cancelada). */
  jaTemRemessa?: boolean;
};

/**
 * A comparação inteira. Devolve sempre um aviso — `nivel: "NENHUM"` quando não
 * há o que dizer — para a tela não precisar de `if` além de olhar o nível.
 */
export function avaliarRemessa(entrada: EntradaDoAvisoDeRemessa): AvisoDeRemessa {
  // Retirada no balcão: ninguém entrega nada, então não há remessa.
  if (String(entrada.modalidadeFrete ?? "").trim().toUpperCase() === "RETIRA") return SEM_AVISO;
  if (entrada.jaTemRemessa) return SEM_AVISO;
  if (!enderecoComparavel(entrada.entrega) || !enderecoComparavel(entrada.nfe)) return SEM_AVISO;

  const entrega = entrada.entrega as EnderecoParaRemessa;
  const nfe = entrada.nfe as EnderecoParaRemessa;
  const resumos = { entrega: resumoDoEndereco(entrega), nfe: resumoDoEndereco(nfe) };

  const outroMunicipio =
    chaveDoMunicipio(limpo(entrega.cidade)) !== chaveDoMunicipio(limpo(nfe.cidade)) ||
    limpo(entrega.uf).toUpperCase() !== limpo(nfe.uf).toUpperCase();
  if (outroMunicipio) {
    return {
      nivel: "FORTE",
      titulo: "Nota de remessa necessária",
      texto: `Entrega em ${cidadeUf(entrega)}, diferente do endereço da NF-e (${cidadeUf(nfe)})`,
      ...resumos
    };
  }

  const outroEndereco =
    soDigitos(limpo(entrega.cep)) !== soDigitos(limpo(nfe.cep)) ||
    chaveDoNumero(limpo(entrega.numero)) !== chaveDoNumero(limpo(nfe.numero)) ||
    chaveDoLogradouro(limpo(entrega.logradouro)) !== chaveDoLogradouro(limpo(nfe.logradouro));
  if (outroEndereco) {
    return {
      nivel: "LEVE",
      titulo: "Entrega em outro endereço",
      texto: "Entrega em endereço diferente do faturamento: confira se precisa de nota de remessa",
      ...resumos
    };
  }

  return SEM_AVISO;
}

/** A dica do selo: a frase e os dois endereços, um por linha. */
export function dicaDoAvisoDeRemessa(aviso: AvisoDeRemessa): string {
  if (aviso.nivel === "NENHUM") return "";
  return [`${aviso.texto}.`, `Entrega: ${aviso.entrega}`, `NF-e: ${aviso.nfe}`, ACAO_DA_REMESSA].join("\n");
}

/* ------------------------------------------------------- a leitura em lote */

/** O que a leitura à parte devolve para a Fila. */
export type LeituraDosAvisosDeRemessa = {
  porPedido: ReadonlyMap<number, AvisoDeRemessa>;
  /** Falso enquanto lê e quando a leitura falhou: aí nenhum selo aparece. */
  pronta: boolean;
};

/** O aviso de uma linha. Leitura não pronta, pedido não lido ou id inválido: nenhum. */
export function avisoDeRemessaDaLinha(
  idInt: number | null | undefined,
  leitura: LeituraDosAvisosDeRemessa
): AvisoDeRemessa {
  if (!leitura.pronta) return SEM_AVISO;
  const id = Number(idInt);
  if (!Number.isFinite(id) || id <= 0) return SEM_AVISO;
  return leitura.porPedido.get(id) ?? SEM_AVISO;
}

/** As linhas cruas que a leitura em lote traz do banco. */
export type DadosParaAvisosDeRemessa = {
  propostas: {
    id_int: number | string | null;
    id_cliente: number | string | null;
    id_faturado: number | string | null;
    id_endereco_ent: string | null;
    modalidade_frete: string | null;
  }[];
  /** `expedicoes`: o endereço do despacho só vale com `data_despacho` preenchida. */
  expedicoes: { id_int: number | string | null; id_endereco_entrega: string | null; data_despacho: string | null }[];
  enderecos: {
    id: string | number | null;
    id_cliente: number | string | null;
    tipo_endereco: string | null;
    endereco: string | null;
    numero: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    data_criacao?: string | null;
  }[];
  /** Notas de remessa do pedido, com o status. */
  remessas: { id_int: number | string | null; status: string | null }[];
};

const STATUS_DE_NOTA_MORTA = ["CANCELADA", "DENEGADA", "INUTILIZADA"];

/** O principal do cliente, pela MESMA ordem de `fn_montar_payload_nfe` e `escolherEnderecoPrincipal`. */
function principalDoCliente(
  enderecos: DadosParaAvisosDeRemessa["enderecos"],
  idCliente: number
): DadosParaAvisosDeRemessa["enderecos"][number] | null {
  const candidatos = enderecos.filter(
    (e) => Number(e.id_cliente) === idCliente && String(e.tipo_endereco ?? "").trim().toLowerCase() === "principal"
  );
  if (candidatos.length === 0) return null;
  return [...candidatos].sort((a, b) => {
    const caixaA = String(a.tipo_endereco ?? "").trim() === "PRINCIPAL" ? 0 : 1;
    const caixaB = String(b.tipo_endereco ?? "").trim() === "PRINCIPAL" ? 0 : 1;
    if (caixaA !== caixaB) return caixaA - caixaB;
    const dataA = a.data_criacao ? Date.parse(a.data_criacao) : Number.NEGATIVE_INFINITY;
    const dataB = b.data_criacao ? Date.parse(b.data_criacao) : Number.NEGATIVE_INFINITY;
    if (dataA !== dataB) return dataB - dataA;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  })[0];
}

const paraComparar = (e: DadosParaAvisosDeRemessa["enderecos"][number] | null | undefined): EnderecoParaRemessa | null =>
  e ? { logradouro: e.endereco, numero: e.numero, cidade: e.cidade, uf: e.uf, cep: e.cep } : null;

/**
 * Monta o aviso de cada pedido a partir das linhas lidas. Pura: quem lê é o
 * serviço, e o teste entrega as linhas à mão.
 *
 * O PAGADOR é `id_faturado` quando diferente do cliente, senão o cliente — a
 * mesma regra de `resolverPagador`, e é dele o endereço que vai na NF-e.
 * O ENDEREÇO DE ENTREGA é o do despacho confirmado, senão o da proposta — a
 * mesma regra de `idEnderecoEntregaVigente`, que a própria remessa usa.
 */
export function avisosDeRemessaPorPedido(dados: DadosParaAvisosDeRemessa): Map<number, AvisoDeRemessa> {
  const porId = new Map(dados.enderecos.map((e) => [String(e.id ?? "").trim(), e] as const));
  const despachoPorPedido = new Map(
    dados.expedicoes
      .filter((x) => x.data_despacho && String(x.id_endereco_entrega ?? "").trim())
      .map((x) => [Number(x.id_int), String(x.id_endereco_entrega).trim()] as const)
  );
  const comRemessa = new Set(
    dados.remessas
      .filter((r) => !STATUS_DE_NOTA_MORTA.includes(String(r.status ?? "").trim().toUpperCase()))
      .map((r) => Number(r.id_int))
  );

  const saida = new Map<number, AvisoDeRemessa>();
  for (const p of dados.propostas) {
    const idInt = Number(p.id_int);
    if (!Number.isFinite(idInt) || idInt <= 0) continue;
    const idCliente = Number(p.id_cliente);
    const idFaturado = Number(p.id_faturado);
    const pagador = Number.isFinite(idFaturado) && idFaturado > 0 && idFaturado !== idCliente ? idFaturado : idCliente;
    const idEntrega = despachoPorPedido.get(idInt) ?? String(p.id_endereco_ent ?? "").trim();
    const aviso = avaliarRemessa({
      modalidadeFrete: p.modalidade_frete,
      entrega: paraComparar(idEntrega ? porId.get(idEntrega) : null),
      nfe: Number.isFinite(pagador) && pagador > 0 ? paraComparar(principalDoCliente(dados.enderecos, pagador)) : null,
      jaTemRemessa: comRemessa.has(idInt)
    });
    if (aviso.nivel !== "NENHUM") saida.set(idInt, aviso);
  }
  return saida;
}
