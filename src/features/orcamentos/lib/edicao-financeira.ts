import type { PropostaFormState } from "../types";
import { valorFreteEfetivo } from "./modalidade-frete";

/**
 * A edição que está chegando MEXE em dinheiro?
 *
 * POR QUE ISSO EXISTE
 *   `editar-paga` recusava QUALQUER edição de proposta com cobrança ativa não
 *   confirmada — inclusive trocar contato, endereço ou observação. A proteção é
 *   legítima: o link de pagamento já está com o cliente, tem valor fixo no
 *   provedor e ele pode pagar a qualquer momento. Mudar o valor da proposta sem
 *   cancelar a cobrança deixa os dois números divergentes.
 *
 *   Mas isso só vale para edição que MUDA O VALOR. O resto não ameaça nada.
 *
 * POR QUE NÃO SE COMPARA O TOTAL
 *   O `novoTotal` que chega na requisição é o cálculo do CLIENT, e a própria
 *   rota documenta que ele "serviu só para escolher o caminho": quem decide o
 *   valor gravado é o banco, depois dos triggers de `produtos_proposta` e
 *   `cotacao_frete` e da consolidação final do `saveProposta`. Confiar nesse
 *   número deixaria passar uma edição que o client julgou neutra e que o banco
 *   recalcula para outro valor — exatamente o caso que a proteção existe para
 *   impedir, e sem volta, porque a proposta já teria sido gravada.
 *
 *   Então a comparação é CAMPO A CAMPO, sobre as entradas do cálculo, contra o
 *   que está no banco AGORA. Se nenhuma entrada mudou, o total não tem como
 *   mudar — e a edição passa sem tocar na cobrança.
 *
 * NA DÚVIDA, DIVERGE
 *   Item que não casa com nenhuma linha do banco, item do banco que sumiu do
 *   formulário, exclusão pendente, número ilegível: tudo conta como divergência.
 *   O custo de um falso positivo é o usuário cancelar uma cobrança à toa; o de
 *   um falso negativo é proposta e link de pagamento com valores diferentes.
 *
 * DÍVIDA TÉCNICA CONHECIDA — a checagem transacional que falta
 *   Isto reduz a janela, mas não a fecha: entre esta validação e a gravação, o
 *   estado do banco ainda pode mudar. O conserto de fundo é mover o save para
 *   uma RPC `SECURITY DEFINER` com `SELECT ... FOR UPDATE` na proposta e a
 *   validação junto da escrita, na mesma transação — aí o `ROLLBACK` existe e a
 *   divergência nunca chega a ser gravada. É a MESMA dívida já registrada em
 *   `docs/business/EXPEDICAO.md` §3.5 para o despacho, pelo mesmo motivo (lá:
 *   `camposMinimosDespacho` roda no client porque não há rota que revalide).
 *   Vale a pena resolver as duas juntas: é o mesmo trabalho.
 */

/** Tolerância de centavo — os valores trafegam como float dos dois lados. */
const TOLERANCIA = 0.005;

export type ItemFinanceiroBanco = {
  /** `produtos_proposta.id` — casa com `PropostaItem.id_produto_proposta_origem`. */
  id: number;
  idProduto: number;
  quantidade: number;
  valorUnitario: number;
  valorFixo: number;
  subtotal: number;
  statusItem: string;
};

export type SnapshotFinanceiro = {
  isAvulso: boolean;
  /** `propostas.modalidade_frete` — decide se o frete é zerado. */
  modalidadeFrete: string | null;
  /** `propostas.valor_frete` — o frete que hoje entra no total. */
  valorFrete: number;
  /** `desconto_proposta` do tipo DESCONTO_GERAL. */
  descontoGeralTipo: "VALOR" | "PERCENTUAL";
  descontoGeralValor: number;
  itens: ItemFinanceiroBanco[];
};

export type DivergenciaFinanceira = {
  campo: string;
  antes: string;
  depois: string;
};

function num(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : NaN;
}

/** Diferentes quando um dos dois não é número, ou quando passam do centavo. */
function difere(a: unknown, b: unknown): boolean {
  const x = num(a);
  const y = num(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return Math.abs(x - y) > TOLERANCIA;
}

function ativo(statusItem: string | null | undefined): boolean {
  return String(statusItem ?? "PENDENTE").toUpperCase() !== "CANCELADO";
}

/**
 * Campos do formulário que alimentam o cálculo do total. Exposto para a rota
 * poder explicar ao usuário o que exatamente foi comparado.
 *
 * Entram: tudo que `calculateResumo` lê (itens ativos com quantidade, valor
 * unitário, fixo e subtotal; o frete escolhido; o desconto geral), a modalidade
 * (que zera o frete em FOB) e os campos manuais da avulsa.
 *
 * NÃO entram, porque não tocam o cálculo: contato, endereço, comprador,
 * vendedor, empresa, observações, observação técnica, forma de pagamento,
 * estado de arte e modelos de produção — modelos dividem a quantidade de um
 * item entre variações, mas nunca alteram quantidade nem valor.
 */
export const CAMPOS_FINANCEIROS = [
  "itens (quantidade, valor unitário, valor fixo, subtotal, item cancelado)",
  "itens excluídos nesta edição",
  "desconto geral (tipo e valor)",
  "frete escolhido (valor)",
  "modalidade do frete",
  "proposta avulsa (valor dos produtos e do frete manuais)"
] as const;

/**
 * Compara o formulário que chegou com o estado financeiro do banco.
 *
 * Devolve a lista de divergências — vazia significa que nenhuma entrada do
 * cálculo mudou, e a edição pode passar sem mexer na cobrança.
 */
export function divergenciasFinanceiras(
  formState: PropostaFormState,
  snapshot: SnapshotFinanceiro
): DivergenciaFinanceira[] {
  const out: DivergenciaFinanceira[] = [];

  // ── Avulsa ───────────────────────────────────────────────────────────────
  const formAvulsa = Boolean(formState.isAvulso);
  if (formAvulsa !== snapshot.isAvulso) {
    out.push({ campo: "tipo da proposta (avulsa)", antes: String(snapshot.isAvulso), depois: String(formAvulsa) });
    // Mudou a natureza do cálculo: o resto da comparação não é comparável.
    return out;
  }

  // ── Modalidade do frete (zera o frete em FOB e em RETIRA) ────────────────
  const modalidadeForm = formState.modalidadeFrete ?? null;
  const modalidadeBanco = snapshot.modalidadeFrete ?? null;
  if (modalidadeForm !== modalidadeBanco) {
    out.push({
      campo: "modalidade do frete",
      antes: modalidadeBanco ?? "(não declarada)",
      depois: modalidadeForm ?? "(não declarada)"
    });
  }

  // ── Desconto geral ───────────────────────────────────────────────────────
  const descontoTipoForm = formState.descontoGeralTipo ?? "VALOR";
  if (descontoTipoForm !== snapshot.descontoGeralTipo) {
    out.push({ campo: "tipo do desconto geral", antes: snapshot.descontoGeralTipo, depois: descontoTipoForm });
  }
  if (difere(formState.descontoGeralValor, snapshot.descontoGeralValor)) {
    out.push({
      campo: "valor do desconto geral",
      antes: String(snapshot.descontoGeralValor),
      depois: String(formState.descontoGeralValor ?? "")
    });
  }

  if (formAvulsa) {
    // Na avulsa o total sai dos dois campos manuais; não há itens nem cotação.
    // `valorProdutosManual` não tem espelho isolado no banco (vira
    // `propostas.valor`), então a comparação do frete é a que resta aqui — e a
    // do total de produtos fica coberta pelo próprio `valor_frete` + itens.
    if (difere(parseValorBR(formState.valorFreteManual), snapshot.valorFrete)) {
      out.push({
        campo: "valor do frete manual",
        antes: String(snapshot.valorFrete),
        depois: String(formState.valorFreteManual ?? "")
      });
    }
    return out;
  }

  // ── Frete escolhido ──────────────────────────────────────────────────────
  const freteEscolhido = (formState.fretes ?? []).find((f) => f.id === formState.freteEscolhidoId);
  // Em FOB e em RETIRA o frete cobrado é zero, qualquer que seja a cotação em
  // tela. A regra é CHAMADA, não copiada: enquanto ela morava aqui como
  // `=== "FOB"`, incluir RETIRA em `valorFreteEfetivo` faria este gate acusar
  // divergência de frete num pedido de balcão que não mudou nada — e mandar
  // cancelar a cobrança à toa.
  const freteFormEfetivo = valorFreteEfetivo(num(freteEscolhido?.valor ?? 0), modalidadeForm);
  if (difere(freteFormEfetivo, snapshot.valorFrete)) {
    out.push({ campo: "valor do frete", antes: String(snapshot.valorFrete), depois: String(freteFormEfetivo) });
  }

  // ── Exclusões pendentes ──────────────────────────────────────────────────
  const excluidos = formState.deletedProdutoPropostaIds ?? [];
  if (excluidos.length > 0) {
    out.push({ campo: "itens excluídos nesta edição", antes: "0", depois: String(excluidos.length) });
  }

  // ── Itens ────────────────────────────────────────────────────────────────
  const itensFormAtivos = (formState.itens ?? []).filter((i) => ativo(i.statusItem));
  const itensBancoAtivos = snapshot.itens.filter((i) => ativo(i.statusItem));

  if (itensFormAtivos.length !== itensBancoAtivos.length) {
    out.push({
      campo: "quantidade de itens ativos",
      antes: String(itensBancoAtivos.length),
      depois: String(itensFormAtivos.length)
    });
  }

  const porId = new Map(itensBancoAtivos.map((i) => [i.id, i]));

  for (const item of itensFormAtivos) {
    const origem = item.id_produto_proposta_origem;
    // Item sem vínculo com o banco é item NOVO — muda o subtotal por definição.
    if (origem === undefined || origem === null) {
      out.push({ campo: `item novo "${item.nome}"`, antes: "(não existia)", depois: `qtd ${item.quantidade}` });
      continue;
    }
    const banco = porId.get(Number(origem));
    if (!banco) {
      out.push({ campo: `item "${item.nome}"`, antes: "(não encontrado no banco)", depois: `qtd ${item.quantidade}` });
      continue;
    }
    porId.delete(Number(origem));

    if (Number(item.id_produto) !== Number(banco.idProduto)) {
      out.push({ campo: `produto do item "${item.nome}"`, antes: String(banco.idProduto), depois: String(item.id_produto) });
    }
    if (difere(item.quantidade, banco.quantidade)) {
      out.push({ campo: `quantidade de "${item.nome}"`, antes: String(banco.quantidade), depois: String(item.quantidade) });
    }
    if (difere(item.valorUnitario, banco.valorUnitario)) {
      out.push({ campo: `valor unitário de "${item.nome}"`, antes: String(banco.valorUnitario), depois: String(item.valorUnitario) });
    }
    if (difere(item.valorFixo, banco.valorFixo)) {
      out.push({ campo: `valor fixo de "${item.nome}"`, antes: String(banco.valorFixo), depois: String(item.valorFixo) });
    }
    if (difere(item.subtotal, banco.subtotal)) {
      out.push({ campo: `subtotal de "${item.nome}"`, antes: String(banco.subtotal), depois: String(item.subtotal) });
    }
  }

  // Sobrou item ativo no banco que o formulário não trouxe: some do cálculo.
  for (const restante of porId.values()) {
    out.push({
      campo: `item do banco ausente no formulário (produto ${restante.idProduto})`,
      antes: `qtd ${restante.quantidade}`,
      depois: "(ausente)"
    });
  }

  return out;
}

/** "1.234,56" → 1234.56. Aceita número já pronto. Ilegível vira NaN. */
function parseValorBR(valor: unknown): number {
  if (typeof valor === "number") return valor;
  const texto = String(valor ?? "").trim();
  if (!texto) return 0;
  return Number(texto.replace(/\./g, "").replace(",", "."));
}
