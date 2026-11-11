import { formatDocument } from "@/lib/formatters/document";
import { textoDeCadastroInvalido } from "@/features/nfse/lib/composicao-nfse";

/**
 * Os campos que o CARTAO FECHADO do endereco de entrega mostra (box 5, 12/10/2026).
 *
 * Antes, o endereco selecionado e as "Outras opcoes de entrega" eram desenhados de
 * jeitos diferentes, e a opcao fechada nao mostrava bairro, complemento, numero
 * separado nem IE. Agora os dois usam o mesmo cartao e a mesma lista de campos,
 * que sai TODA do que o endereco ja carrega (`CadastroEndereco` / tabela
 * `enderecos`): nada de campo novo, nada lido so de dentro da edicao.
 *
 * Sempre aparecem: Endereco (rua e numero), Complemento, Bairro, Cidade / UF, CEP
 * e Tipo — vazio vira "—" apagado, para o dado que falta ficar a vista. So
 * aparecem se existirem: Recebedor, CPF do recebedor, IE do recebedor e
 * Referencia. O endereco nao tem telefone nem outro contato (a tabela nao tem a
 * coluna), entao nao ha o que mostrar. Latitude, longitude e distancia sao dados
 * internos de frete e nao fazem parte da entrega que o atendente confere.
 */

export type EnderecoParaCartao = {
  tipo?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  obs?: string | null;
  recebedor?: string | null;
  cpfRecebedor?: string | null;
  ieRecebedor?: string | null;
};

export type CampoDoCartao = {
  /** Identifica o campo (testes e `key`). */
  chave: string;
  rotulo: string;
  valor: string;
  /** Valor ausente ("—"): sai apagado. */
  apagado: boolean;
  /** Colunas que ocupa na grade do cartao: 1, 2 ou a linha inteira. */
  largura: 1 | 2 | "linha";
  /** O campo de maior peso do cartao (o endereco): fonte maior. */
  principal?: boolean;
};

/** Campo preenchido so com um traco e vazio para exibicao (ex.: complemento "-"). */
export function semTraco(valor: string | null | undefined): string {
  const texto = (valor ?? "").trim();
  return texto === "-" || texto === "—" ? "" : texto;
}

export function cepExibicao(cep: string | null | undefined): string {
  const digitos = (cep ?? "").replace(/\D/g, "").slice(0, 8);
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : cep ?? "";
}

/** O que a tela mostra no lugar de uma rua gravada como lixo ("[object Object]"). */
export const RUA_COM_ERRO_NO_CADASTRO = "Rua com erro no cadastro (corrija pelo lápis)";

/**
 * Campo do endereço sem o lixo de cadastro quebrado (11/11/2026): "[object Object]",
 * "NULL" e afins viram vazio. 20 endereços têm "[object Object]" na rua (25052).
 */
export function textoDoEndereco(valor: string | null | undefined): string {
  return textoDeCadastroInvalido(valor) ? "" : (valor ?? "").trim();
}

/** "Rua X, 123": rua e numero, sem virgula sobrando. Rua quebrada vira o aviso. */
export function logradouroDe(endereco: EnderecoParaCartao): string {
  const rua = textoDeCadastroInvalido(endereco.endereco) ? RUA_COM_ERRO_NO_CADASTRO : (endereco.endereco ?? "").trim();
  return [rua, textoDoEndereco(endereco.numero)].filter(Boolean).join(", ");
}

const ou = (texto: string) => texto || "—";

export function camposDoCartaoDeEndereco(endereco: EnderecoParaCartao): CampoDoCartao[] {
  const logradouro = logradouroDe(endereco);
  const complemento = semTraco(textoDoEndereco(endereco.complemento));
  const bairro = textoDoEndereco(endereco.bairro);
  const cidadeUf = [endereco.cidade, endereco.uf].map(textoDoEndereco).filter(Boolean).join("/");
  const cep = cepExibicao(endereco.cep).trim();
  const tipo = (endereco.tipo ?? "").trim();
  const recebedor = (endereco.recebedor ?? "").trim();
  const cpf = (endereco.cpfRecebedor ?? "").trim();
  const ie = (endereco.ieRecebedor ?? "").trim();
  const referencia = (endereco.obs ?? "").trim();

  const campos: CampoDoCartao[] = [
    { chave: "endereco", rotulo: "Endereço", valor: ou(logradouro), apagado: !logradouro, largura: 2, principal: true },
    { chave: "complemento", rotulo: "Complemento", valor: ou(complemento), apagado: !complemento, largura: 1 },
    { chave: "bairro", rotulo: "Bairro", valor: ou(bairro), apagado: !bairro, largura: 1 },
    { chave: "cidadeUf", rotulo: "Cidade / UF", valor: ou(cidadeUf), apagado: !cidadeUf, largura: 1 },
    { chave: "cep", rotulo: "CEP", valor: ou(cep), apagado: !cep, largura: 1 },
    { chave: "tipo", rotulo: "Tipo", valor: tipo || "Tipo não informado", apagado: !tipo, largura: 1 }
  ];
  if (recebedor) campos.push({ chave: "recebedor", rotulo: "Recebedor", valor: recebedor, apagado: false, largura: 2 });
  if (cpf) campos.push({ chave: "cpfRecebedor", rotulo: "CPF do recebedor", valor: formatDocument(cpf), apagado: false, largura: 1 });
  if (ie) campos.push({ chave: "ieRecebedor", rotulo: "IE do recebedor", valor: ie, apagado: false, largura: 1 });
  if (referencia) campos.push({ chave: "obs", rotulo: "Referência", valor: referencia, apagado: false, largura: "linha" });
  return campos;
}
