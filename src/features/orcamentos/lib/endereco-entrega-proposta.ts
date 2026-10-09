/**
 * ENDERECO DE ENTREGA GRAVADO PELO ORCAMENTO (09/10/2026).
 *
 * O CASO: pedido 23320. Em proposta ja salva, o botao "Salvar endereco" e o
 * lapis do bloco 5 abriam o endereco VINCULADO para UPDATE. A proposta nasce
 * vinculada ao endereco PRINCIPAL do cliente, que e o fiscal — o destinatario
 * da NF-e sai dele (`fn_montar_payload_nfe`). Quem digitava ali o endereco de
 * entrega regravava o endereco fiscal, e a nota saiu para o endereco errado.
 *
 * A REGRA
 *   - Endereco PRINCIPAL (ou o unico do cadastro) nunca e alterado por aqui: o
 *     que foi digitado vira um endereco NOVO do tipo ENTREGA, e e ele que o
 *     pedido passa a usar. O principal so muda no cadastro do cliente.
 *   - Se o cadastro ja tem um endereco de ENTREGA igual ao digitado (CEP,
 *     numero, rua e complemento), ele e reaproveitado em vez de duplicado.
 *   - Endereco que ja e de entrega continua sendo editado como antes.
 *   - O orcamento nunca cria nem grava o tipo PRINCIPAL.
 *
 * DUAS TRAVAS, de proposito. A decisao (`decidirGravacaoDoEndereco`) escolhe o
 * caminho; `atualizarEnderecoDoOrcamento` recusa o UPDATE de um principal de
 * qualquer jeito — pela leitura previa, que da a mensagem clara, e pelo filtro
 * do proprio UPDATE, que vale mesmo se o tipo mudar entre a leitura e a escrita.
 *
 * O cliente do Supabase entra por parametro para o teste rodar sem banco
 * (scripts/testes/endereco-entrega-proposta.test.mts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CadastroEndereco } from "@/features/cadastros/types";

export const MENSAGEM_PRINCIPAL_SO_NO_CADASTRO =
  "O endereço principal é o fiscal e só se altera no cadastro do cliente.";

const COLUNAS =
  "id, id_cliente, cep, endereco, numero, complemento, bairro, cidade, uf, tipo_endereco, recebedor, cpf_recebedor, ie_recebedor";

/** A linha de `enderecos` como o banco devolve. */
export type LinhaEndereco = {
  id: string;
  id_cliente: number | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  tipo_endereco: string | null;
  recebedor: string | null;
  cpf_recebedor: string | null;
  ie_recebedor: string | null;
};

export type EnderecoDigitado = Omit<CadastroEndereco, "id">;

export type AcaoDoEndereco = "editado" | "criado" | "reutilizado" | "sem_mudanca";

export type ResultadoEndereco = {
  success: boolean;
  data?: CadastroEndereco;
  errorMessage?: string;
  /** O que foi feito com o que a pessoa digitou. So vem quando `success`. */
  acao?: AcaoDoEndereco;
};

// ── Regras puras ────────────────────────────────────────────────────────────

/** A grafia varia no banco (PRINCIPAL, principal, Principal): compara sem caixa. */
export function ehTipoPrincipal(tipo: string | null | undefined): boolean {
  return (tipo || "").trim().toUpperCase() === "PRINCIPAL";
}

function ehTipoEntrega(tipo: string | null | undefined): boolean {
  return (tipo || "").trim().toUpperCase() === "ENTREGA";
}

/**
 * O tipo que o orcamento grava: sempre em maiusculas e nunca PRINCIPAL.
 * Devolve `null` quando o pedido e de principal — quem chama recusa.
 */
export function tipoQueOOrcamentoGrava(tipo: string | null | undefined): "ENTREGA" | "COBRANCA" | "FISCAL" | null {
  const limpo = (tipo || "").trim().toUpperCase();
  if (limpo === "PRINCIPAL") return null;
  if (limpo === "COBRANCA" || limpo === "COBRANÇA") return "COBRANCA";
  if (limpo === "FISCAL") return "FISCAL";
  return "ENTREGA";
}

function semAcento(valor: string | null | undefined): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const soDigitos = (valor: string | null | undefined) => (valor || "").replace(/\D/g, "");

type Local = { cep?: string | null; endereco?: string | null; numero?: string | null; complemento?: string | null };

/** Mesmo lugar: CEP, numero, rua e complemento, sem acento, caixa nem pontuacao. */
export function mesmoLocal(a: Local, b: Local): boolean {
  return (
    soDigitos(a.cep) === soDigitos(b.cep) &&
    semAcento(a.numero) === semAcento(b.numero) &&
    semAcento(a.endereco) === semAcento(b.endereco) &&
    semAcento(a.complemento) === semAcento(b.complemento)
  );
}

function mesmoRecebedor(digitado: EnderecoDigitado, linha: LinhaEndereco): boolean {
  return (
    semAcento(digitado.recebedor) === semAcento(linha.recebedor) &&
    soDigitos(digitado.cpfRecebedor) === soDigitos(linha.cpf_recebedor) &&
    semAcento(digitado.ieRecebedor) === semAcento(linha.ie_recebedor)
  );
}

/** Bairro, cidade e UF: fora do "mesmo lugar", mas contam para saber se algo mudou. */
function mesmoRestante(digitado: EnderecoDigitado, linha: LinhaEndereco): boolean {
  return (
    semAcento(digitado.bairro) === semAcento(linha.bairro) &&
    semAcento(digitado.cidade) === semAcento(linha.cidade) &&
    semAcento(digitado.uf) === semAcento(linha.uf)
  );
}

/**
 * Protegido = o orcamento nao altera. E o endereco PRINCIPAL, ou o unico do
 * cadastro (sem outro, e ele que a nota usa, qualquer que seja o tipo).
 */
export function enderecoProtegido(vinculado: LinhaEndereco, doCadastro: LinhaEndereco[]): boolean {
  if (ehTipoPrincipal(vinculado.tipo_endereco)) return true;
  return !doCadastro.some((linha) => linha.id !== vinculado.id);
}

export type Decisao =
  | { acao: "editar" }
  | { acao: "sem_mudanca" }
  | { acao: "reutilizar"; idEndereco: string }
  | { acao: "criar" };

/** O que fazer com o que foi digitado sobre o endereco `vinculado`. */
export function decidirGravacaoDoEndereco(
  vinculado: LinhaEndereco,
  doCadastro: LinhaEndereco[],
  digitado: EnderecoDigitado
): Decisao {
  if (!enderecoProtegido(vinculado, doCadastro)) return { acao: "editar" };

  if (mesmoLocal(digitado, vinculado) && mesmoRestante(digitado, vinculado) && mesmoRecebedor(digitado, vinculado)) {
    return { acao: "sem_mudanca" };
  }

  const igual = doCadastro.find(
    (linha) => linha.id !== vinculado.id && ehTipoEntrega(linha.tipo_endereco) && mesmoLocal(digitado, linha)
  );
  if (igual) return { acao: "reutilizar", idEndereco: igual.id };

  return { acao: "criar" };
}

// ── Gravacao ────────────────────────────────────────────────────────────────

function paraCadastroEndereco(linha: LinhaEndereco): CadastroEndereco {
  return {
    id: linha.id,
    cep: linha.cep || "",
    endereco: linha.endereco || "",
    numero: linha.numero || "",
    complemento: linha.complemento || "",
    bairro: linha.bairro || "",
    cidade: linha.cidade || "",
    uf: linha.uf || "",
    tipo: ((linha.tipo_endereco || "entrega").trim().toLowerCase() as CadastroEndereco["tipo"]) || "entrega",
    recebedor: linha.recebedor || "",
    cpfRecebedor: linha.cpf_recebedor || "",
    ieRecebedor: linha.ie_recebedor || ""
  };
}

/** Filtro do proprio UPDATE: linha principal nao casa, entao nada e gravado. */
const FILTRO_NAO_PRINCIPAL = "tipo_endereco.is.null,tipo_endereco.not.ilike.*principal*";

/**
 * UPDATE de um endereco pelo orcamento. Recusa linha PRINCIPAL e recusa
 * reclassificar qualquer linha como principal.
 */
export async function atualizarEnderecoDoOrcamento(
  client: SupabaseClient,
  id: string,
  endereco: EnderecoDigitado
): Promise<ResultadoEndereco> {
  const tipo = tipoQueOOrcamentoGrava(endereco.tipo);
  if (!tipo) return { success: false, errorMessage: MENSAGEM_PRINCIPAL_SO_NO_CADASTRO };

  const { data: atual, error: erroLeitura } = await client
    .from("enderecos")
    .select("id, tipo_endereco")
    .eq("id", id)
    .maybeSingle();
  if (erroLeitura) return { success: false, errorMessage: erroLeitura.message || "Erro ao ler o endereço." };
  if (!atual) return { success: false, errorMessage: "Endereço não encontrado." };
  if (ehTipoPrincipal((atual as { tipo_endereco: string | null }).tipo_endereco)) {
    return { success: false, errorMessage: MENSAGEM_PRINCIPAL_SO_NO_CADASTRO };
  }

  const { data, error } = await client
    .from("enderecos")
    .update({
      cep: endereco.cep,
      endereco: endereco.endereco,
      numero: endereco.numero,
      complemento: endereco.complemento || null,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      uf: endereco.uf,
      tipo_endereco: tipo,
      recebedor: endereco.recebedor || null,
      cpf_recebedor: endereco.cpfRecebedor || null,
      ie_recebedor: endereco.ieRecebedor || null
    })
    .eq("id", id)
    .or(FILTRO_NAO_PRINCIPAL)
    .select(COLUNAS)
    .maybeSingle();

  if (error) return { success: false, errorMessage: error.message || "Erro ao atualizar endereço no banco." };
  // Nenhuma linha: o endereco virou principal entre a leitura e a escrita.
  if (!data) return { success: false, errorMessage: MENSAGEM_PRINCIPAL_SO_NO_CADASTRO };

  return { success: true, acao: "editado", data: paraCadastroEndereco(data as LinhaEndereco) };
}

/**
 * Grava so o recebedor de um endereco que NAO e principal.
 *
 * Existe porque o gatilho `trg_preencher_dados_recebedor_endereco` (BEFORE
 * INSERT) troca recebedor, documento e IE pelos do cliente em todo INSERT: o
 * que foi digitado so fica com um UPDATE depois. Falha aqui nao desfaz o
 * endereco ja criado — devolve a linha como esta.
 */
async function gravarRecebedorDigitado(
  client: SupabaseClient,
  linha: LinhaEndereco,
  digitado: EnderecoDigitado
): Promise<LinhaEndereco> {
  const temRecebedorDigitado = Boolean((digitado.recebedor || "").trim() || soDigitos(digitado.cpfRecebedor));
  if (!temRecebedorDigitado || mesmoRecebedor(digitado, linha)) return linha;

  const { data } = await client
    .from("enderecos")
    .update({
      recebedor: digitado.recebedor || null,
      cpf_recebedor: digitado.cpfRecebedor || null,
      ie_recebedor: digitado.ieRecebedor || null
    })
    .eq("id", linha.id)
    .or(FILTRO_NAO_PRINCIPAL)
    .select(COLUNAS)
    .maybeSingle();

  return (data as LinhaEndereco | null) || linha;
}

/** INSERT de um endereco pelo orcamento. Nunca do tipo PRINCIPAL. */
export async function inserirEnderecoDoOrcamento(
  client: SupabaseClient,
  endereco: EnderecoDigitado & { id_cliente: number }
): Promise<ResultadoEndereco> {
  const tipo = tipoQueOOrcamentoGrava(endereco.tipo);
  if (!tipo) return { success: false, errorMessage: MENSAGEM_PRINCIPAL_SO_NO_CADASTRO };

  const { data, error } = await client
    .from("enderecos")
    .insert([
      {
        id_cliente: endereco.id_cliente,
        cep: endereco.cep,
        endereco: endereco.endereco,
        numero: endereco.numero,
        complemento: endereco.complemento || null,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        uf: endereco.uf,
        tipo_endereco: tipo,
        recebedor: endereco.recebedor || null,
        cpf_recebedor: endereco.cpfRecebedor || null,
        ie_recebedor: endereco.ieRecebedor || null
      }
    ])
    .select(COLUNAS)
    .single();

  if (error) return { success: false, errorMessage: error.message || "Erro ao salvar endereço no banco." };
  if (!data) return { success: false, errorMessage: "Endereço não retornado após inserção." };

  const linha = await gravarRecebedorDigitado(client, data as LinhaEndereco, endereco);
  return { success: true, acao: "criado", data: paraCadastroEndereco(linha) };
}

/**
 * O "Salvar" do modal aberto sobre um endereco existente (botao "Salvar
 * endereco" e lapis do bloco 5). Decide entre editar, criar um endereco de
 * entrega novo, reaproveitar um igual ou nao fazer nada. NAO grava na proposta:
 * quem chama troca a selecao e o Salvar da proposta grava `id_endereco_ent`.
 */
export async function salvarEnderecoDeEntrega(
  client: SupabaseClient,
  idVinculado: string,
  digitado: EnderecoDigitado
): Promise<ResultadoEndereco> {
  const { data: lido, error: erroVinculado } = await client
    .from("enderecos")
    .select(COLUNAS)
    .eq("id", idVinculado)
    .maybeSingle();
  if (erroVinculado) return { success: false, errorMessage: erroVinculado.message || "Erro ao ler o endereço." };
  const vinculado = lido as LinhaEndereco | null;
  if (!vinculado) return { success: false, errorMessage: "Endereço não encontrado." };
  if (vinculado.id_cliente == null) {
    return { success: false, errorMessage: "Endereço sem cadastro vinculado; corrija no cadastro do cliente." };
  }

  const { data: lista, error: erroLista } = await client
    .from("enderecos")
    .select(COLUNAS)
    .eq("id_cliente", vinculado.id_cliente);
  if (erroLista) return { success: false, errorMessage: erroLista.message || "Erro ao ler os endereços do cadastro." };
  const doCadastro = (lista as LinhaEndereco[] | null) || [];

  const decisao = decidirGravacaoDoEndereco(vinculado, doCadastro, digitado);

  if (decisao.acao === "editar") return atualizarEnderecoDoOrcamento(client, idVinculado, digitado);

  if (decisao.acao === "sem_mudanca") {
    return { success: true, acao: "sem_mudanca", data: paraCadastroEndereco(vinculado) };
  }

  if (decisao.acao === "reutilizar") {
    const existente = doCadastro.find((linha) => linha.id === decisao.idEndereco) as LinhaEndereco;
    const linha = await gravarRecebedorDigitado(client, existente, digitado);
    return { success: true, acao: "reutilizado", data: paraCadastroEndereco(linha) };
  }

  // O tipo do rascunho e o do endereco aberto (principal): o novo e sempre ENTREGA.
  return inserirEnderecoDoOrcamento(client, { ...digitado, tipo: "entrega", id_cliente: vinculado.id_cliente });
}
