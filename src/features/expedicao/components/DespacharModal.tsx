"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  correiosResiduoDeCotacaoFob,
  labelTipoFrete,
  modalidadeInicialDoDespacho,
  normalizarTipoFrete,
  origemDaModalidadeInicial
} from "../lib/tipo-frete";
import { idDestinatarioEtiquetaVigente, temPagadorDistinto } from "../lib/destinatario-etiqueta";
import { pareceTelefone, telefoneDestinatario } from "../lib/telefone-destinatario";
import { rotuloClienteComNumero } from "../lib/cliente-rotulo";
import { despachar, salvarDadosExpedicao, transportadoraDerivada } from "../services/expedicao-acoes.service";
import type { AtorExpedicao, DespachoInput, ResultadoAcao } from "../services/expedicao-acoes.service";
// `listarEnderecosCliente` NÃO é mais importada: o endereço vem resolvido em
// `pedido.enderecoEntrega`. A função segue intacta em `enderecos.service.ts`,
// caso a escolha manual precise voltar.
import type { EnderecoCliente } from "../services/enderecos.service";
import { correiosStatus, gerarPrepostagem } from "../services/correios.client";
import { etiquetaDoPedido } from "../lib/etiqueta-do-pedido";
import { carregarPreviaEtiqueta } from "../services/etiqueta.client";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";
import { EtiquetaPreview } from "./EtiquetaPreview";
import { ConfirmarAcaoModal } from "./ConfirmarAcaoModal";
import {
  camposMinimosDespacho,
  frasearFaltantes,
  TRANSPORTES_QUE_EXIGEM_TRANSPORTADORA
} from "../lib/campos-minimos-despacho";
import { divergenciaFreteDoDespacho, formatarCep, frasearMotivos } from "../lib/divergencia-frete-despacho";
import { recotarFrete, aplicarRecotacao, buscarLiberacaoAtiva } from "../services/recotacao.client";
import type { RecotacaoResult, OpcaoRecotacao, AplicacaoRecotacao } from "../services/recotacao.client";
import { LABEL_MODALIDADE, MODALIDADES_OFERECIDAS, TRANSPORTES_POR_MODALIDADE } from "../types";
import type { ModalidadeFrete, PedidoExpedicao, TipoFreteNormalizado } from "../types";

const TIPOS_VOLUME = ["Pacote", "Caixa", "Envelope", "Outro"];

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1";

type Transportadora = { id_cliente: number; nome: string | null; fantasia: string | null };

/**
 * "1.234,5" -> 1234.5 (vírgula decimal, pontos de milhar removidos); "12.4" ->
 * 12.4 (só ponto = decimal, não mexe). Compartilhada por handleConfirmar e
 * handleGerarPrepostagem para os dois lerem o peso do mesmo jeito.
 */
function parsePesoKg(valor: string): number | null {
  const trim = valor.trim();
  if (trim === "") return null;
  const normalizado = trim.includes(",") ? trim.replace(/\./g, "").replace(",", ".") : trim;
  return Number(normalizado);
}

function parseQtdVolumes(valor: string): number | null {
  const trim = valor.trim();
  return trim === "" ? null : Math.trunc(Number(trim));
}

/**
 * Default do endereço de entrega quando não há um já salvo (spec §4.6): (1) o
 * que casa com o CEP da cotação escolhida; (2) senão o marcado como endereço
 * de entrega (tipo_endereco contendo "ENTREG"); (3) senão, o mais recente da
 * lista (que já cobre o caso de sobrar um único cadastro).
 */
/**
 * Transporte com que o formulário abre. `SEM_CUSTO`, `INDEFINIDO` e
 * `RETIRA_BALCAO` não são opções do passo 2 (os dois primeiros são leitura de
 * cotação legada; o último vem da modalidade), então o form abre em
 * TRANSPORTADORA e o expedidor confirma o que de fato vai acontecer.
 */
function transporteInicial(
  pedido: PedidoExpedicao,
  tipo: TipoFreteNormalizado,
  modalidade: ModalidadeFrete | null
): TipoFreteNormalizado {
  /**
   * DEGRAU 1 — o resíduo SEDEX não semeia o formulário (02/09/2026).
   *
   * Terceiro ponto contaminado pela mesma cotação zerada: o Kanban agrupava o
   * pedido em Correios (`e1855ed`), o alerta acusava troca de transporte
   * (`dee4819`), e aqui o formulário ABRIA em `CORREIOS`. Mesmo predicado dos
   * outros dois, importado de `lib/tipo-frete` — a regra não está duplicada, e
   * ela já se desliga sozinha em despacho confirmado e em CIF.
   */
  const base = correiosResiduoDeCotacaoFob(pedido) ? "TRANSPORTADORA" : tipo;

  /**
   * DEGRAU 2 — O SELECT NUNCA MENTE, em nenhum caso.
   *
   * O `<select value={tipoFrete}>` do "Como vai" só lista
   * `TRANSPORTES_POR_MODALIDADE[modalidade]`. Um `select` cujo `value` não está
   * entre as `option` exibe a PRIMEIRA delas — a tela dizia "Transportadora"
   * enquanto o estado era `CORREIOS`, e o botão de etiqueta, que lê o estado,
   * oferecia prepostagem dos Correios num envio de transportadora.
   *
   * Esta guarda é estrutural, não é sobre os cinco pedidos: garante que o
   * estado inicial SEMPRE seja uma das opções que o select mostra. Quando não
   * for, vence o que está na tela — é o que o expedidor vê e o que ele
   * submeteria sem tocar em nada.
   *
   * Em CIF nada muda: `CORREIOS` está na lista de lá.
   */
  if (modalidade === "FOB" || modalidade === "CIF") {
    const opcoes = TRANSPORTES_POR_MODALIDADE[modalidade];
    return opcoes.includes(base) ? base : opcoes[0];
  }

  // RETIRA e modalidade nula não renderizam o select — vale a normalização de
  // sempre: `SEM_CUSTO` e `INDEFINIDO` são leitura de cotação legada, não
  // transporte, e o expedidor confirma o que de fato vai acontecer.
  return base === "CORREIOS" || base === "MOTOBOY" || base === "TRANSPORTADORA" ? base : "TRANSPORTADORA";
}

/**
 * Default do endereco de entrega. SO OLHA ENDERECOS DO CLIENTE DA PROPOSTA.
 *
 * Desde 24/08/2026 a lista pode trazer tambem enderecos do pagador, mas eles
 * NAO entram nesta escolha: aparecem para selecao manual e nada mais. O
 * automatismo que acertaria a proposta 21055 mudaria o default de todos os
 * outros pedidos — e o expedidor e quem sabe para onde a caixa vai.
 *
 * A ordem nao mudou: CEP igual ao da cotacao > primeiro com tipo contendo
 * "ENTREG" > primeiro da lista (o mais recente).
 */
// SEM CHAMADOR desde 02/09/2026, e mantida de propósito: o endereço agora vem
// definido da proposta, e esta era a regra de default da escolha manual. Fica
// aqui pronta para voltar se a escolha for reaberta.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escolherEnderecoDefault(lista: EnderecoCliente[], freteCep: string | null): EnderecoCliente | null {
  if (lista.length === 0) return null;
  const cepAlvo = freteCep ? freteCep.replace(/\D/g, "") : "";
  const porCep = cepAlvo ? lista.find((e) => (e.cep ?? "").replace(/\D/g, "") === cepAlvo) : undefined;
  if (porCep) return porCep;
  const porTipoEntrega = lista.find((e) => (e.tipo ?? "").toUpperCase().includes("ENTREG"));
  if (porTipoEntrega) return porTipoEntrega;
  return lista[0];
}

export function DespacharModal({
  pedido,
  modoEdicao,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  modoEdicao: boolean;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const exp = pedido.expedicao;

  const tipoInicial: TipoFreteNormalizado = exp?.tipoFrete ?? pedido.tipoFrete;

  /**
   * Modalidade (quem paga) é a escolha do PASSO 1 e comanda o resto do modal.
   *
   * A precedência vive em `lib/tipo-frete.ts` (`modalidadeInicialDoDespacho`),
   * com o raciocínio inteiro documentado lá: despacho > cotação de balcão >
   * orçamento > nada, com FOB imune ao degrau da cotação. Aqui fica só a
   * chamada — a regra é testada fora da tela.
   *
   * Discordar da sugestão continua livre e não altera a proposta; a divergência
   * aparece no aviso abaixo e informa, não trava.
   */
  // Calculada FORA do `useState` porque `transporteInicial` também precisa dela:
  // o transporte de abertura tem de ser uma das opções que ESTA modalidade
  // oferece, senão o select abre exibindo uma coisa e o estado guarda outra.
  const modalidadeInicial = modalidadeInicialDoDespacho(
    exp?.modalidadeFrete,
    pedido.modalidadeOrcamento,
    tipoInicial,
    pedido.despachoConfirmado
  );
  /**
   * A MODALIDADE VIRA LEITURA QUANDO ALGUÉM JÁ DECIDIU (03/09/2026).
   *
   * Quem paga o frete é decisão do ORÇAMENTO, não da bancada: o expedidor
   * declara o que saiu pela porta, não quem banca a conta. Com a modalidade
   * resolvida, a tela a exibe e diz onde se troca.
   *
   * OS BOTÕES CONTINUAM quando ela é nula — e aí não é luxo, é a única saída:
   * `handleConfirmar` barra com "Escolha a modalidade do frete", e sem os botões
   * o pedido ficaria impossível de despachar. Medido em 03/09/2026: 4 pedidos
   * abertos no painel (20413, 20517, 20678, 20890) e 8.233 propostas no
   * histórico não têm modalidade em lugar nenhum, e nenhum dos 4 cai no degrau
   * da cotação de balcão. A proposta também não os resolve:
   * `podeEditarModalidade` congela o campo a partir de LIBERADO.
   *
   * LÊ `modalidadeInicial`, NÃO `modalidade`: precisa ser constante durante a
   * vida do modal. Com o estado vivo, os botões sumiriam no primeiro clique e
   * prenderiam quem errasse a escolha.
   */
  const modalidadeTravada = modalidadeInicial !== null;
  const origemModalidade = origemDaModalidadeInicial(
    exp?.modalidadeFrete,
    pedido.modalidadeOrcamento,
    tipoInicial,
    pedido.despachoConfirmado
  );
  const [modalidade, setModalidade] = useState<ModalidadeFrete | null>(modalidadeInicial);
  const [tipoFrete, setTipoFrete] = useState<TipoFreteNormalizado>(
    transporteInicial(pedido, tipoInicial, modalidadeInicial)
  );
  const [transportadoraNome, setTransportadoraNome] = useState(
    exp?.transportadoraNome ?? (pedido.tipoFrete === "INDEFINIDO" ? "" : pedido.transportadoraNome)
  );
  /** Mesma precedência da modalidade: despacho > orçamento > nada. */
  const [idTransportadoraCliente, setIdTransportadoraCliente] = useState<number | null>(
    exp?.idTransportadoraCliente ?? pedido.idTransportadoraOrcamento ?? null
  );
  /**
   * NASCE VAZIO quando ninguem aferiu ainda (21/08/2026).
   *
   * O campo se chama "Peso aferido" e vinha pre-preenchido com `pedido.pesoKg`
   * — que, pela precedencia de `lib/peso.ts`, e o cotado ou o teorico dos itens
   * quando nao ha aferido. Ou seja: o modal ja entregava a resposta pronta, e
   * confirmar sem tocar no campo gravava o ESTIMADO como se fosse balanca. A
   * divergencia de peso entao comparava o cotado contra ele mesmo e nunca
   * acusava nada.
   *
   * DESDE 22/08/2026 ele volta a nascer preenchido — mas com a SOMA do
   * `peso_real_kg` de cada setor, que a Revisao do boletim mediu na balanca.
   * Isso nao reintroduz o problema acima: o que chega aqui e pesagem, nao
   * estimativa. O previsto (cotado/teorico) continua a vista logo abaixo do
   * campo, porque o expedidor precisa dos dois para julgar.
   *
   * `exp?.pesoKg` continua preenchendo: esse SIM e peso aferido de verdade,
   * gravado num despacho anterior ou no rascunho de "Salvar sem despachar" —
   * apaga-lo obrigaria a expedidora a pesar de novo o que ela ja pesou.
   *
   * O estimado nao some da tela: segue no `placeholder` como "previsto X".
   */
  const [pesoKg, setPesoKg] = useState(
    exp?.pesoKg?.toString() ?? pedido.pesoRealSetoresKg?.toString() ?? ""
  );
  const [qtdVolumes, setQtdVolumes] = useState(exp?.qtdVolumes?.toString() ?? pedido.volumes?.toString() ?? "1");
  const [tipoVolume, setTipoVolume] = useState(exp?.tipoVolume ?? "Pacote");
  const [codigoRastreamento, setCodigoRastreamento] = useState(pedido.codigoRastreamento);
  /**
   * O TEXTO QUE VAI COLADO NO VOLUME (02/09/2026). Coluna propria
   * (`expedicoes.obs_etiqueta`), separada da observacao logistica acima: aquela
   * e recado interno da bancada e nao sai em documento nenhum.
   */
  const [obsEtiqueta, setObsEtiqueta] = useState(exp?.obsEtiqueta ?? "");
  /**
   * NUMERO DA NF — `notas_fiscais.numero_nf` SEMPRE VENCE.
   *
   * `pedido.nfNumero` ja vem resolvido pelo pipeline com
   * `escolherNotaAutorizadaDoPedido`, o MESMO criterio que a etiqueta imprime:
   * so AUTORIZADA, so com numero, mais recente por `data_autorizacao`. Havendo
   * nota, o campo e somente leitura e este estado nem e enviado. So sem nota o
   * expedidor digita, e ai grava em `expedicoes.nf_numero_manual`.
   */
  const [nfNumeroManual, setNfNumeroManual] = useState(exp?.nfNumeroManual ?? "");
  /**
   * O TELEFONE QUE VAI IMPRESSO (`expedicoes.telefone_etiqueta`, 04/09/2026).
   *
   * `null` = NUNCA EDITADO NESTA SESSAO, e ai o campo EXIBE o que o SERVIDOR
   * resolveu (o gravado, senao o do cadastro). String (mesmo vazia) = o
   * expedidor mexeu, e vale o que ele digitou.
   *
   * OS DOIS ESTADOS SAO DIFERENTES, e por isso o tipo e `string | null`:
   * com um `string` so, apagar o campo o faria voltar sozinho ao numero do
   * cadastro na tecla seguinte, e o expedidor nao conseguiria limpar nada.
   *
   * NASCE `null`, NUNCA DE `exp?.telefoneEtiqueta` (04/09/2026). Semear do
   * prop parece obvio e esta ERRADO: `pedido.expedicao` e a FOTO que a lista
   * carregou, e "Gerar etiqueta" salva SEM recarregar a lista. Medido em teste:
   * editar o telefone, gerar a etiqueta e reabrir o modal trazia de volta o
   * valor ANTERIOR — a tela contradizia o PDF, que le o banco. Nascendo nulo, o
   * campo sempre mostra o que o servidor acabou de resolver.
   *
   * O QUE GRAVA: `null` nao entra no upsert ("nao mexa"); "" grava NULL
   * ("segue o cadastro"). Nao ha como dizer "imprima sem telefone" — limpar o
   * campo devolve o numero do cadastro.
   *
   * NUNCA TOCA O CADASTRO: `clientes.whatsapp_1` e `telefone_fixo` ficam como
   * estao. Este numero vale so para esta remessa.
   */
  const [telefoneEtiqueta, setTelefoneEtiqueta] = useState<string | null>(null);
  const temNotaAutorizada = pedido.nfStatus === "AUTORIZADA" && Boolean(pedido.nfNumero);
  /**
   * ENDEREÇO DE ENTREGA: EXIBIÇÃO, NÃO ESCOLHA (02/09/2026).
   *
   * Deixou de ser estado. Vem resolvido de `pedido.enderecoEntrega`, que já
   * aplica a precedência (despacho confirmado > endereço da proposta) no
   * pipeline da lista. O `select` saiu: ele listava também os endereços do
   * pagador e os de outras cidades, e trocar endereço é operação da PROPOSTA.
   *
   * O que ele grava não mudou — `expedicoes.id_endereco_entrega` continua
   * recebendo este id, e etiqueta, declaração e prepostagem seguem lendo de lá.
   */
  const idEnderecoEntrega = pedido.enderecoEntrega?.id ?? null;
  const [transportadoras, setTransportadoras] = useState<Transportadora[]>([]);
  const [confirmaSemNf, setConfirmaSemNf] = useState(false);
  const [confirmaTrocaCorreios, setConfirmaTrocaCorreios] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [correiosOk, setCorreiosOk] = useState(false);
  const [gerandoPrepostagem, setGerandoPrepostagem] = useState(false);
  /**
   * Prepostagem criada NESTA sessao do modal. `pedido.expedicao` e a foto que a
   * lista carregou e nao se atualiza aqui — sem isto, gerar a prepostagem e
   * tentar imprimir em seguida ainda diria "gere a prepostagem".
   */
  const [prepostagemGeradaAgora, setPrepostagemGeradaAgora] = useState(false);
  const [emitindoEtiqueta, setEmitindoEtiqueta] = useState(false);
  /** Servico aguardando confirmacao de regeracao; null = nenhum dialogo aberto. */
  const [confirmarRegeracao, setConfirmarRegeracao] = useState<"SEDEX" | "PAC" | null>(null);
  /**
   * EM NOME DE QUEM A ETIQUETA SAI.
   *
   * So existe quando ha pagador distinto do cliente. O padrao e o PAGADOR
   * (decisao do dono, 24/08/2026): quando os dois cadastros diferem, e ele quem
   * costuma receber. Escolha ja gravada sempre vence o padrao — reabrir o modal
   * nao troca o que o expedidor decidiu.
   *
   * Nao mexe no endereco: sao escolhas separadas, e a caixa pode ir para o
   * endereco de um em nome do outro.
   */
  const [idDestinatarioEtiqueta, setIdDestinatarioEtiqueta] = useState<number | null>(
    // A regra saiu daqui para `lib/destinatario-etiqueta.ts` em 02/09/2026: era
    // ela que o modal aplicava e os documentos não, e a tela dizia um nome
    // enquanto o papel imprimia outro.
    idDestinatarioEtiquetaVigente({
      despachoConfirmado: pedido.despachoConfirmado,
      idClienteProposta: pedido.idCliente,
      idFaturado: pedido.idFaturado,
      idGravadoNoDespacho: exp?.idClienteDestinatarioEtiqueta
    })
  );
  /**
   * Transporte que a recotacao escolheu mas a modalidade atual nao oferece
   * (na pratica: Correios recotado num pedido FOB). A tela diz o que houve em
   * vez de trocar a modalidade sozinha — mudar quem paga o frete nao e efeito
   * colateral de aplicar uma cotacao.
   */
  const [transporteRecotadoForaDaModalidade, setTransporteRecotadoForaDaModalidade] = useState<string | null>(null);

  /**
   * Recotação (Parte C, Etapa 1) — SÓ CONSULTA. Nada é gravado por este bloco:
   * nem o valor do frete, nem a proposta, nem a Conta Corrente. Serve para o
   * expedidor ver o número real antes de trocar transportadora ou endereço.
   */
  const [recotando, setRecotando] = useState(false);
  const [recotacao, setRecotacao] = useState<RecotacaoResult | null>(null);
  const [erroRecotacao, setErroRecotacao] = useState<string | null>(null);

  /**
   * Aplicacao (Parte C, Etapa 2) — ESTA grava: `propostas.valor_frete`, o
   * `valor_total` movido pelo delta do frete, e uma linha no ledger
   * `expedicao_recotacoes`. Continua sem tocar `cotacao_frete` e sem lancar
   * nada na Conta Corrente.
   *
   * `chavesPorOpcao` e a idempotencia: uma uuid POR OPCAO, gerada quando o
   * resultado da cotacao chega — nunca no clique. Clicar duas vezes manda a
   * mesma chave, e quem recusa a segunda e o unique do banco, nao o estado
   * desta tela (que ja falhou nesse papel quatro vezes neste projeto).
   */
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [aplicacao, setAplicacao] = useState<AplicacaoRecotacao | null>(null);
  const [erroAplicacao, setErroAplicacao] = useState<string | null>(null);
  const [chavesPorOpcao, setChavesPorOpcao] = useState<Record<string, string>>({});

  /**
   * O botão só aparece no despacho de um pedido CIF. `modalidade` já nasce da
   * precedência despacho > cotação de balcão > orçamento (ver
   * `modalidadeInicialDoDespacho`), então um modal recém-aberto obedece
   * exatamente a regra do banco — e marcar CIF agora também libera, o que é o
   * momento em que o expedidor mais precisa do número. A rota revalida o gate
   * contra o banco de qualquer forma.
   */
  const podeRecotar = pedido.statusInterno === "EXPEDICAO" && modalidade === "CIF";

  /**
   * Desde 20/08/2026 o expedidor NAO recota por conta propria: um admin libera
   * caso a caso pelo menu Acoes da Expedicao. A liberacao vem carregada com a
   * lista (`PedidoExpedicao.liberacaoRecotacao`), nao por fetch daqui — assim o
   * menu e este modal leem a mesma fonte e nunca se contradizem.
   *
   * O bloco continua VISIVEL sem liberacao, com o botao desabilitado e o motivo
   * escrito: o expedidor precisa saber que a funcao existe e de quem depende,
   * nao concluir que ela sumiu.
   */
  /**
   * ESTADO DO PEDIDO, NAO DO FORMULARIO.
   *
   * O valor inicial vem do prop — carregado com a lista, mesma fonte do menu
   * Acoes. Mas o prop e um SNAPSHOT tirado quando o modal abriu: se o admin
   * liberar (ou revogar) enquanto ele esta aberto, o modal nunca ficaria
   * sabendo. Por isso o valor vive em estado e e RELIDO do banco na abertura.
   *
   * Nao ha fonte concorrente aqui: e a mesma tabela que alimenta a lista. O que
   * se resolve e a defasagem do snapshot, nao a origem do dado.
   *
   * `limparRecotacao()` NAO toca nisto de proposito: liberacao e autorizacao do
   * admin, e editar peso, endereco ou transportadora nao pode revoga-la.
   */
  const [liberacao, setLiberacao] = useState(pedido.liberacaoRecotacao);
  const recotacaoLiberada = Boolean(liberacao);

  useEffect(() => {
    let vivo = true;
    void buscarLiberacaoAtiva(pedido.idInt).then((atual) => {
      if (vivo) setLiberacao(atual);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idInt]);

  /** Resultado velho ao lado de destino novo é pior que resultado nenhum. */
  function limparRecotacao() {
    setRecotacao(null);
    setErroRecotacao(null);
    setAplicacao(null);
    setErroAplicacao(null);
    setChavesPorOpcao({});
  }

  async function handleRecotar() {
    if (recotando) return;
    setRecotando(true);
    setErroRecotacao(null);
    setAplicacao(null);
    setErroAplicacao(null);
    const res = await recotarFrete(pedido.idInt, idEnderecoEntrega);
    setRecotando(false);
    if (res.success) {
      setRecotacao(res);
      // Uma chave por opcao, AGORA — nao no clique.
      const chaves: Record<string, string> = {};
      for (const o of res.opcoes ?? []) chaves[o.id] = crypto.randomUUID();
      setChavesPorOpcao(chaves);
    } else {
      setRecotacao(null);
      setChavesPorOpcao({});
      setErroRecotacao(res.errorMessage || "Não foi possível recotar agora.");
    }
  }

  /**
   * Com NF-e autorizada so entra o que BARATEIA: empatar nao justifica mexer no
   * valor de um pedido que ja tem nota. Encarecer depende da alcada e fica para
   * a etapa seguinte. A rota e a RPC repetem os dois gates contra o banco.
   */
  function podeAplicar(o: OpcaoRecotacao): boolean {
    if (o.diferenca > 0) return false;
    if (pedido.nfStatus === "AUTORIZADA" && o.diferenca >= 0) return false;
    return true;
  }

  function motivoBloqueio(o: OpcaoRecotacao): string {
    if (o.diferenca > 0) return "Encarece: depende da alçada, ainda não liberado.";
    return "Com NF-e autorizada, só o que barateia.";
  }

  async function handleAplicar(o: OpcaoRecotacao) {
    if (aplicandoId) return;
    const chave = chavesPorOpcao[o.id];
    if (!chave) {
      setErroAplicacao("Recote antes de aplicar.");
      return;
    }
    setAplicandoId(o.id);
    setErroAplicacao(null);
    const res = await aplicarRecotacao({
      idInt: pedido.idInt,
      chave,
      opcaoId: o.id,
      valorVisto: o.valor,
      idEnderecoEntrega
    });
    setAplicandoId(null);
    if (res.success) {
      setAplicacao(res);
      // A aplicacao consome a liberacao no banco, na mesma transacao. Refletir
      // aqui evita o selo continuar dizendo "liberado" depois de gasto.
      if (!res.idempotente) setLiberacao(null);

      // O TRANSPORTE RECOTADO passa a ser o do formulario.
      //
      // Ate aqui, aplicar "Expresso Sao Miguel - Rodoviario" gravava o novo
      // frete na proposta e deixava "Como vai" e a transportadora exatamente
      // como estavam: o despacho saia com um transporte e a proposta cobrava
      // outro. Quem aplicou tinha de repetir a escolha na mao, e nada avisava.
      if (o.transportadora) setTransportadoraNome(o.transportadora);
      setIdTransportadoraCliente(null);
      const recotado = normalizarTipoFrete(o.servico || o.transportadora);
      // So seleciona o que a modalidade oferece. CORREIOS em FOB continua fora
      // (a prepostagem sai do cartao da empresa) — nesse caso a tela avisa em
      // vez de escolher por conta propria.
      // Sem modalidade escolhida ainda, a referencia e CIF: e a mais ampla, e a
      // validacao de campos minimos continua exigindo a escolha antes de despachar.
      const oferecidos = TRANSPORTES_POR_MODALIDADE[modalidade === "FOB" ? "FOB" : "CIF"];
      if (oferecidos.includes(recotado)) {
        setTipoFrete(recotado);
        setTransporteRecotadoForaDaModalidade(null);
      } else {
        setTransporteRecotadoForaDaModalidade(labelTipoFrete(recotado));
      }
    }
    else setErroAplicacao(res.errorMessage || "Não foi possível aplicar agora.");
  }

  /**
   * O service continua decidindo o status destino por `tipoEntrega`
   * (RETIRADA → "A RETIRAR", TRANSPORTE → "EM TRANSITO"). Ele agora é derivado
   * da modalidade, em vez de ser um toggle próprio.
   */
  const tipoEntrega: "TRANSPORTE" | "RETIRADA" = modalidade === "RETIRA" ? "RETIRADA" : "TRANSPORTE";

  /**
   * Contato de quem RECEBE, seguindo o drop "Em nome de quem sai a etiqueta".
   * Sem pagador distinto o drop nem existe e o contato e sempre o do cliente.
   */
  const contatoDestinatario =
    idDestinatarioEtiqueta !== null && idDestinatarioEtiqueta === pedido.idFaturado && pedido.contatoPagador
      ? pedido.contatoPagador
      : pedido.contatoCliente;

  /**
   * Telefone digitado que NAO e telefone. Barra a gravacao, como o peso
   * invalido ja faz — a alternativa era gravar "ramal 12" e ve-lo ser
   * ignorado na leitura, com a etiqueta saindo com o numero do cadastro e
   * ninguem entendendo por que.
   */
  const telefoneEtiquetaInvalido =
    telefoneEtiqueta !== null && telefoneEtiqueta.trim() !== "" && !pareceTelefone(telefoneEtiqueta);

  /**
   * O QUE GRAVA — e `undefined` significa NAO MEXA (04/09/2026).
   *
   * Sem edicao nesta sessao (`null`), a coluna nao entra no upsert. Foi um bug
   * de verdade em teste: `pedido.expedicao` e a FOTO que a lista carregou, e
   * "Gerar etiqueta" salva sem recarregar a lista — reabrindo o modal, o estado
   * nascia `null` mesmo havendo telefone gravado, e mandar "" teria APAGADO o
   * numero de quem so quis corrigir a observacao.
   *
   * Mesmo contrato de `obs` em `DespachoInput`: `undefined` = nao mexa, "" =
   * volte ao cadastro.
   */
  const telefoneEtiquetaParaGravar = telefoneEtiqueta === null ? undefined : telefoneEtiqueta.trim();

  /**
   * O que ainda falta para despachar. O botao passa a olhar isto, e nao so o
   * `salvando` — ate 20/08/2026 dava para confirmar sem definir nada, porque a
   * unica guarda de campo obrigatorio era a modalidade, e ela parou de barrar
   * quando CIF virou o padrao das propostas novas.
   *
   * Em modo edicao a lista e sempre vazia de proposito: o pedido ja saiu, e
   * exigir campo agora impediria corrigir o que existe.
   */
  const nomeExibicao = useMemo(
    () => (t: Transportadora) => t.fantasia || t.nome || `#${t.id_cliente}`,
    []
  );

  /**
   * O nome de transportadora que VAI PARA O BANCO — fonte única das três
   * gravações (despachar, salvar sem despachar, prepostagem), do resumo de
   * divergência e da checagem de campos mínimos.
   *
   * COM VÍNCULO, MANDA O CADASTRO. Era isto que faltava: o formulário tinha dois
   * campos escrevendo no mesmo estado — o select da transportadora e um input
   * rotulado "Serviço" —, e quem digitasse o serviço depois de escolher a
   * transportadora apagava o nome dela. Foi o que aconteceu no pedido 21245:
   * ficou `id_transportadora_cliente = 808` (SVT TRANSPORTES) com
   * `transportadora_nome = 'ECOMM'`, e a etiqueta imprimiu ECOMM. O input de
   * serviço saiu do formulário; enquanto não houver coluna própria para ele,
   * serviço não se grava em lugar nenhum.
   *
   * SEM VÍNCULO, VALE O TEXTO LIVRE. A transportadora sem cadastro continua
   * sendo nomeada à mão — são 3 dos 8 despachos de TRANSPORTADORA da base, e
   * `camposMinimosDespacho` exige nome OU vínculo para despachar. Sem o campo
   * livre, escolher "sem vínculo" viraria um beco sem saída.
   *
   * FALLBACK ENQUANTO A LISTA NÃO CHEGOU: sem o cadastro em mãos, cai no texto
   * atual, que é o pré-preenchimento vindo do orçamento
   * (`expedicao.service.ts`, já corrigido por `nomeTransporteEfetivo`). Nunca
   * grava vazio por causa de uma consulta ainda em voo.
   */
  const nomeTransportadoraParaGravar = useMemo(() => {
    if (idTransportadoraCliente !== null) {
      const t = transportadoras.find((x) => x.id_cliente === idTransportadoraCliente);
      if (t) return nomeExibicao(t);
    }
    return transportadoraNome.trim();
  }, [idTransportadoraCliente, transportadoras, transportadoraNome, nomeExibicao]);

  /**
   * `faltantes` BLOQUEIA O QUE CONTRATA OU IMPRIME, nao o que corrige.
   *
   * Etiqueta e prepostagem exigem os campos minimos sempre que o pedido ainda
   * nao saiu — imprimir rotulo ou contratar transporte de um envio que ninguem
   * terminou de declarar e o erro que esta regra existe para impedir.
   *
   * SALVAR em modo edicao NAO passa por aqui: e uma gravacao PARCIAL, que nao
   * transiciona status nem confirma despacho, e travar o `Salvar dados` deixaria
   * um pedido ainda na fabrica sem como corrigir a observacao da etiqueta ou o
   * rastreio. Hoje isso alcanca o 21409, que nao tem peso, volumes nem
   * transportadora e continua editavel.
   */
  const faltantes = useMemo(
    () =>
      camposMinimosDespacho(
        {
          tipoEntrega,
          modalidadeFrete: modalidade,
          // O MESMO nome que o service vai gravar. Em MOTOBOY o campo esta
          // oculto e o valor e derivado la; sem espelhar aqui, a tela pediria
          // uma transportadora que ninguem tem como informar.
          transportadoraNome: transportadoraDerivada(tipoFrete, nomeTransportadoraParaGravar),
          idTransportadoraCliente,
          pesoKg: parsePesoKg(pesoKg),
          qtdVolumes: parseQtdVolumes(qtdVolumes),
          idEnderecoEntrega,
          tipoFrete
        },
        // O QUE DISPENSA A VALIDACAO E O PEDIDO JA TER SAIDO (02/09/2026).
        //
        // Era `modoEdicao`, e funcionava enquanto "Editar dados de expedicao" so
        // existia depois do despacho: porta e estado eram a mesma coisa. Desde
        // `e6abe36` a acao alcanca pedido AINDA NA BANCADA, e o gate por porta
        // passou a dispensar a exigencia de quem nunca a cumpriu — dava para
        // imprimir uma 10x15 sem peso, volumes, transportadora nem endereco.
        //
        // A justificativa de 20/08 continua valendo, com a redacao corrigida: o
        // pedido JA SAIU, e obrigar o campo agora impediria corrigir o que
        // existe. O que mudou e que agora e o estado que responde, nao a porta.
        pedido.despachoConfirmado ? "EDICAO" : "DESPACHO"
      ),
    [
      tipoEntrega,
      modalidade,
      nomeTransportadoraParaGravar,
      idTransportadoraCliente,
      pesoKg,
      qtdVolumes,
      idEnderecoEntrega,
      tipoFrete,
      pedido.despachoConfirmado
    ]
  );

  /**
   * O SALVAR so e barrado no DESPACHO. Em edicao a gravacao e parcial, nao
   * transiciona status nem confirma despacho — ver o comentario de `faltantes`.
   */
  const faltamParaSalvar = !modoEdicao && faltantes.length > 0;

  /**
   * O envio que esta na tela ainda corresponde ao frete que a proposta cobra?
   * Recalculado a cada mudanca de peso ou de endereco. INFORMA, nao bloqueia —
   * mesma regra da falta de NF-e.
   */
  // O CEP vem junto do endereço resolvido — não há mais lista local onde buscar.
  const cepDoEnderecoEscolhido = pedido.enderecoEntrega?.cep ?? pedido.freteCep ?? null;

  /**
   * A "cotacao vigente" e a ULTIMA recotacao aplicada, quando houver — nao a
   * `cotacao_frete`, que e imutavel para a Expedicao e nao muda quando uma
   * recotacao e aplicada. `aplicacao` cobre o caso da MESMA sessao: aplicar
   * limpa o bloqueio na hora, sem reabrir o modal; `pedido.recotacaoVigente`
   * cobre a reabertura, vindo carregado com a lista.
   */
  const cotacaoVigente = useMemo(() => {
    const daSessao =
      aplicacao?.success && aplicacao.pesoGramas !== undefined
        ? { pesoGramas: aplicacao.pesoGramas ?? null, cep: aplicacao.cep ?? null }
        : null;
    const referencia = daSessao ?? pedido.recotacaoVigente;
    return {
      pesoGramas: referencia ? referencia.pesoGramas : pedido.pesoCotadoGramas,
      cep: referencia ? referencia.cep : pedido.freteCep,
      valor: aplicacao?.success ? aplicacao.freteNovo ?? pedido.freteValor : pedido.freteValor,
      servico: pedido.freteServico,
      existe: pedido.freteValor !== null
    };
  }, [aplicacao, pedido.recotacaoVigente, pedido.pesoCotadoGramas, pedido.freteCep, pedido.freteValor, pedido.freteServico]);

  const divergencia = useMemo(() => {
    const pesoNum = parsePesoKg(pesoKg);
    return divergenciaFreteDoDespacho({
      cotacao: cotacaoVigente,
      pesoAferidoGramas: pesoNum !== null ? Math.round(pesoNum * 1000) : null,
      cepDestino: cepDoEnderecoEscolhido,
      modalidadeEfetiva: modalidade,
      tipoFreteEscolhido: tipoFrete,
      tipoFreteJaDespachado: pedido.despachoConfirmado ? exp?.tipoFrete ?? null : null
    });
  }, [pesoKg, cepDoEnderecoEscolhido, cotacaoVigente, modalidade, tipoFrete, exp?.tipoFrete, pedido.despachoConfirmado]);


  /**
   * Pedido cujo envio JÁ existe nos Correios. Marcar FOB nele significaria
   * rebaixar o transporte para TRANSPORTADORA e perder a informação de que a
   * encomenda foi postada pelos Correios — por isso a troca nunca acontece
   * sozinha: exige a confirmação explícita do bloco de aviso abaixo. A
   * prepostagem, o código de objeto e o rastreio NÃO são apagados em nenhum
   * caso; só o rótulo do transporte muda.
   */
  const prepostagemCorreios = exp?.correiosCodigoObjeto ?? exp?.correiosIdPrepostagem ?? null;
  /**
   * NINGUÉM DISSE CORREIOS — só o texto da cotação (02/09/2026).
   *
   * O aviso acusava "definido para ir pelos Correios" em pedido FOB com
   * transportadora definida, onde o único sinal de Correios é um `SEDEX` de
   * cotação zerada que ninguém contratou. Mesma causa já corrigida no
   * agrupamento do Kanban (`e1855ed`), e o predicado é literalmente o mesmo,
   * importado de `lib/tipo-frete` — a regra não está duplicada.
   *
   * DUAS GUARDAS a mais, porque aqui o aviso protege coisa que o Kanban não
   * protegia, e silenciá-lo por engano é pior do que mostrá-lo à toa:
   *   - `prepostagemCorreios`: existindo prepostagem ou código de objeto, o
   *     envio EXISTE nos Correios e o aviso continua — é o caso do pedido
   *     legado, e rebaixar o transporte sem confirmação perderia o rastro;
   *   - `exp?.tipoFrete`: se o expedidor já declarou o transporte em rascunho,
   *     vale a declaração dele, não a classificação do texto.
   */
  const residuoSedexFob = correiosResiduoDeCotacaoFob(pedido);
  const correiosSoNoTextoDaCotacao =
    residuoSedexFob && prepostagemCorreios === null && (exp?.tipoFrete ?? null) === null;
  const gravadoComoCorreios = tipoInicial === "CORREIOS" && !correiosSoNoTextoDaCotacao;
  /**
   * Geracao anterior, a que sera SOBRESCRITA na proxima. So existe uma vaga: e o
   * ultimo momento em que este codigo aparece para o operador, e por isso a
   * confirmacao o mostra em texto selecionavel.
   */
  const prepostagemAnterior = exp?.correiosCodigoObjetoAnterior ?? exp?.correiosIdPrepostagemAnterior ?? null;
  const trocaCorreiosPendente = gravadoComoCorreios && modalidade === "FOB" && !confirmaTrocaCorreios;

  const precisaAvisoNf = !modoEdicao && pedido.nfStatus !== "AUTORIZADA";

  /**
   * PASSO 2 em diante so existe nas modalidades de ENVIO (FOB e CIF). Retira
   * nao tem transporte a definir, e o FOB pendente de confirmacao fica fechado
   * ate o expedidor resolver a troca dos Correios. A mesma condicao governa o
   * drop "Em nome de quem sai a etiqueta", que desde 04/09/2026 fica acima da
   * previa, fora do bloco — por isso ela e nomeada aqui, uma vez.
   */
  const mostraEnvio = (modalidade === "FOB" || modalidade === "CIF") && !trocaCorreiosPendente;

  /**
   * Divergência entre o que o vendedor declarou no orçamento e o que o expedidor
   * está escolhendo agora. Aparece na tela, nomeando o que veio do orçamento —
   * mas NÃO bloqueia e NÃO reescreve `propostas`: quem despacha sabe o que
   * saiu pela porta, e a proposta continua sendo o registro comercial.
   */
  const nomeTransportadoraOrcamento = useMemo(() => {
    if (pedido.idTransportadoraOrcamento === null) return null;
    const t = transportadoras.find((x) => x.id_cliente === pedido.idTransportadoraOrcamento);
    return t ? t.fantasia || t.nome || `#${t.id_cliente}` : `#${pedido.idTransportadoraOrcamento}`;
  }, [pedido.idTransportadoraOrcamento, transportadoras]);

  const modalidadeDivergente =
    pedido.modalidadeOrcamento !== null && modalidade !== null && modalidade !== pedido.modalidadeOrcamento;
  const transportadoraDivergente =
    pedido.idTransportadoraOrcamento !== null &&
    idTransportadoraCliente !== null &&
    idTransportadoraCliente !== pedido.idTransportadoraOrcamento;

  useEffect(() => {
    let ativo = true;
    // A busca de endereços saiu daqui (02/09/2026): o endereço vem resolvido em
    // `pedido.enderecoEntrega` e não há mais o que escolher. Uma consulta a
    // menos por abertura do modal.
    void getTransportadoras().then((lista) => {
      if (!ativo) return;
      const transps = lista as Transportadora[];
      setTransportadoras(transps);
      // Transportadora veio pré-selecionada do orçamento e o despacho ainda não
      // tem nome próprio gravado: resolve o nome pelo cadastro, senão o campo
      // ficaria mostrando o texto da cotação, que pode dizer outra coisa.
      if (!exp?.transportadoraNome && idTransportadoraCliente !== null) {
        const t = transps.find((x) => x.id_cliente === idTransportadoraCliente);
        if (t) setTransportadoraNome(t.fantasia || t.nome || `#${t.id_cliente}`);
      }
    });
    void correiosStatus().then((s) => {
      if (ativo) setCorreiosOk(s.configurado);
    });
    return () => {
      ativo = false;
    };
    // Roda só quando o cliente muda: idEnderecoEntrega e pedido.freteCep são
    // lidos apenas para decidir o default (linha acima) — incluí-los nas deps
    // reexecutaria o efeito a cada seleção de endereço, refazendo as buscas à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.idCliente]);

  /**
   * PREVIA DA ETIQUETA 10x15 (04/09/2026).
   *
   * A BASE vem do servidor: `carregarPreviaEtiqueta` chama a rota que executa
   * o MESMO `montarEtiquetaViewModel` do PDF — destinatario, endereco,
   * remetente, transportadora e telefone resolvidos pela mesma funcao. Nada
   * disso e recalculado aqui.
   *
   * Recarrega quando o drop "Em nome de quem sai a etiqueta" muda, porque o
   * NOME do pagador segue uma regra de precedencia (`nome || fantasia`) que so
   * o servidor aplica — o `pedido.pagador` da lista usa outra
   * (`fantasia || nome`), e a previa mostraria um nome que o papel nao imprime.
   * A escolha viaja como override e passa pela mesma validacao do gravado.
   *
   * O que o expedidor DIGITA e sobreposto na hora, em `vmPrevia`, sem ida ao
   * banco: NF manual, volumes e observacao. Sao exatamente os campos que
   * `salvarFormularioSemDespachar` grava antes de o PDF ser gerado — assim o
   * papel sai igual a tela.
   */
  const [previaBase, setPreviaBase] = useState<{ vm: EtiquetaViewModel; qrDataUrl: string | null } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  // "Carregando" e DERIVADO, nao gravado: enquanto nao ha base nem erro, esta
  // montando. Numa recarga (troca de destinatario) a previa anterior fica na
  // tela ate a nova chegar — sem piscar, e sem `setState` sincrono no effect.
  const carregandoPrevia = previaBase === null && erroPrevia === null;

  useEffect(() => {
    let vivo = true;
    void carregarPreviaEtiqueta(pedido.idInt, idDestinatarioEtiqueta).then((res) => {
      if (!vivo) return;
      if (res.success && res.vm) {
        setPreviaBase({ vm: res.vm, qrDataUrl: res.qrDataUrl ?? null });
        setErroPrevia(null);
      } else {
        setErroPrevia(res.errorMessage || "Não foi possível montar a prévia.");
      }
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idInt, idDestinatarioEtiqueta]);

  const vmPrevia = useMemo<EtiquetaViewModel | null>(() => {
    if (!previaBase) return null;
    const vol = parseQtdVolumes(qtdVolumes);
    const pesoNum = parsePesoKg(pesoKg);
    return {
      ...previaBase.vm,
      // Mesmo teto da rota do PDF (1 a 50); fora dele vale o que esta gravado.
      volumes: vol !== null && Number.isFinite(vol) && vol > 0 && vol <= 50 ? vol : previaBase.vm.volumes,
      // PESO: so a conferencia dos Correios o mostra (a 10x15 nao imprime peso
      // desde 26/08). Mesma formatacao do view model; invalido cai no gravado.
      pesoKg:
        pesoNum !== null && Number.isFinite(pesoNum) && pesoNum > 0
          ? pesoNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : previaBase.vm.pesoKg,
      // Com nota autorizada o numero vem do servidor (`notas_fiscais` vence);
      // sem nota, o que esta sendo digitado — que e o que sera gravado.
      nfNumero: temNotaAutorizada ? previaBase.vm.nfNumero : nfNumeroManual.trim(),
      obsEtiqueta: obsEtiqueta.trim(),
      destinatario: {
        ...previaBase.vm.destinatario,
        /**
         * O TELEFONE EDITADO reflete na hora, sem ida ao banco (04/09/2026).
         *
         * MESMA funcao e MESMA ordem que o servidor aplica em
         * `montarEtiquetaViewModel`: o editado primeiro, o cadastro depois.
         * `telefoneCadastro` vem do view model justamente para este fallback —
         * assim limpar o campo devolve o numero do cadastro na tela exatamente
         * como devolveria no papel.
         */
        telefone:
          telefoneEtiqueta === null
            ? // NINGUEM EDITOU NESTA SESSAO: vale o que o SERVIDOR resolveu, que
              // ja inclui `telefone_etiqueta` gravado. Recalcular aqui a partir
              // do estado da tela sobrescreveria o numero certo pelo do cadastro
              // sempre que a lista estivesse defasada — a previa diria uma coisa
              // e o PDF, que le o banco, imprimiria outra.
              previaBase.vm.destinatario.telefone
            : telefoneDestinatario(telefoneEtiqueta, previaBase.vm.destinatario.telefoneCadastro)
      }
    };
  }, [previaBase, qtdVolumes, pesoKg, nfNumeroManual, obsEtiqueta, temNotaAutorizada, telefoneEtiqueta]);

  /**
   * O que o campo de telefone MOSTRA. Sem edicao nesta sessao vale o telefone
   * que o SERVIDOR resolveu (gravado, senao o do cadastro) — a mesma fonte do
   * PDF, e por isso campo, previa e papel dizem sempre o mesmo. Enquanto a
   * previa nao chegou, o contato do destinatario da lista segura o lugar.
   *
   * Trocar o drop "Em nome de quem" recarrega a previa e troca este numero
   * junto; uma edicao manual sobrevive a troca, que e o certo — o expedidor
   * digitou aquele numero de proposito.
   */
  const telefoneEtiquetaExibido =
    telefoneEtiqueta ?? vmPrevia?.destinatario.telefone ?? contatoDestinatario.telefone;

  /** O numero exibido e o do cadastro, ou ja e uma edicao desta remessa? */
  const telefoneVeioDoCadastro =
    telefoneEtiquetaExibido === (previaBase?.vm.destinatario.telefoneCadastro ?? contatoDestinatario.telefone);

  async function handleConfirmar() {
    if (salvando) return;
    if (modalidade === null) {
      showToast({
        type: "warning",
        title: "Escolha a modalidade do frete",
        description: "Diga quem paga o transporte: Retira, FOB ou CIF."
      });
      return;
    }
    if (trocaCorreiosPendente) {
      showToast({
        type: "warning",
        title: "Confirme a troca do transporte",
        description: "Este envio está gravado como Correios. Marque a confirmação para trocá-lo por transportadora."
      });
      return;
    }
    if (precisaAvisoNf && !confirmaSemNf) {
      showToast({ type: "warning", title: "Confirme o despacho sem NF", description: "Marque a caixa de confirmação para despachar sem nota autorizada." });
      return;
    }
    if (faltamParaSalvar) {
      showToast({
        type: "warning",
        title: "Faltam dados para despachar",
        description: `Informe ${frasearFaltantes(faltantes)}.`
      });
      return;
    }
    if (divergencia.bloqueia) {
      showToast({
        type: "warning",
        title: "Despacho bloqueado",
        description: `Recote o frete antes de despachar: ${frasearMotivos(divergencia.motivosBloqueio)}.`
      });
      return;
    }
    const pesoNum = parsePesoKg(pesoKg);
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return;
    }
    const volNum = parseQtdVolumes(qtdVolumes);
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0 || volNum > 50)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes deve ser entre 1 e 50." });
      return;
    }
    if (telefoneEtiquetaInvalido) {
      showToast({
        type: "error",
        title: "Telefone inválido",
        description: "Informe o telefone com DDD (ex.: (51) 99110-8552) ou apague o campo para usar o do cadastro."
      });
      return;
    }

    const input: DespachoInput = {
      tipoEntrega,
      modalidadeFrete: modalidade,
      tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,
      transportadoraNome: tipoEntrega === "RETIRADA" ? "Retira balcão" : nomeTransportadoraParaGravar,
      idTransportadoraCliente: tipoEntrega === "RETIRADA" ? null : idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      idClienteDestinatarioEtiqueta: idDestinatarioEtiqueta,
      codigoRastreamento: codigoRastreamento.trim(),
      obsEtiqueta: obsEtiqueta.trim(),
      // Sem nota autorizada o expedidor digita; havendo, `notas_fiscais`
      // vence e o manual nem e enviado — nao ha como sobrescrever o
      // numero de uma nota emitida.
      nfNumeroManual: temNotaAutorizada ? "" : nfNumeroManual.trim(),
      telefoneEtiqueta: telefoneEtiquetaParaGravar
    };

    setSalvando(true);
    const res = modoEdicao
      ? await salvarDadosExpedicao(pedido.idInt, input)
      : await despachar(pedido.idInt, input, ator);
    setSalvando(false);

    if (res.success) {
      /**
       * A MENSAGEM DIZ O DESFECHO REAL (02/09/2026, Etapa 7).
       *
       * `res.aguardandoColeta` vem de `despachar` e só é verdadeiro quando NÃO
       * houve transição: TRANSPORTADORA e MOTOBOY seguem em `EXPEDICAO`
       * esperando o carro. Anunciar "Pedido despachado" ali mandaria o
       * expedidor parar de olhar para um volume que ainda está na casa.
       */
      showToast({
        type: "success",
        title: modoEdicao
          ? "Dados de expedição salvos"
          : tipoEntrega === "RETIRADA"
            ? "Pedido aguardando retirada"
            : res.aguardandoColeta
              ? "Despacho registrado — aguardando coleta"
              : "Pedido despachado",
        description: res.aguardandoColeta
          ? `#${pedido.idInt} · ${pedido.cliente} — confirme a coleta quando a transportadora levar o volume.`
          : `#${pedido.idInt} · ${pedido.cliente}`
      });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível salvar", description: res.error });
    }
  }

  /**
   * "Salvar sem despachar" — rascunho.
   *
   * O expedidor precisa alterar peso, endereco ou transporte, fechar o modal
   * para pedir liberacao ao admin, e reencontrar o que preencheu. Ate 20/08/2026
   * nao havia como: sem despachar, nada era gravado, e reabrir devolvia os dados
   * originais.
   *
   * Grava em `expedicoes` pelo caminho que ja existia (`salvarDadosExpedicao`,
   * usado no modo edicao), SEM tocar `data_despacho` — e por isso o pedido
   * continua nao despachado, a `etapa` nao muda, e a etiqueta e a visao por
   * transportadora seguem ignorando estes dados.
   *
   * Rascunho NAO exige campo: e justamente o estado incompleto que ele serve
   * para preservar. Por isso `camposMinimosDespacho(..., "EDICAO")`.
   */
  /**
   * A GRAVACAO DO RASCUNHO, sem o desfecho (04/09/2026): valida peso e volumes,
   * grava por `salvarDadosExpedicao` e devolve o resultado. `null` = a validacao
   * barrou e o toast ja foi mostrado. Dois chamadores: "Salvar sem despachar"
   * e a emissao da etiqueta, que grava antes de gerar (`handleEmitirEtiqueta`).
   */
  async function salvarFormularioSemDespachar(): Promise<ResultadoAcao | null> {
    const pesoNum = parsePesoKg(pesoKg);
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return null;
    }
    const volNum = parseQtdVolumes(qtdVolumes);
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0 || volNum > 50)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes deve ser entre 1 e 50." });
      return null;
    }
    if (telefoneEtiquetaInvalido) {
      showToast({
        type: "error",
        title: "Telefone inválido",
        description: "Informe o telefone com DDD (ex.: (51) 99110-8552) ou apague o campo para usar o do cadastro."
      });
      return null;
    }

    setSalvando(true);
    const res = await salvarDadosExpedicao(pedido.idInt, {
      modalidadeFrete: modalidade,
      tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,
      transportadoraNome: tipoEntrega === "RETIRADA" ? "Retira balcão" : nomeTransportadoraParaGravar,
      idTransportadoraCliente: tipoEntrega === "RETIRADA" ? null : idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      idClienteDestinatarioEtiqueta: idDestinatarioEtiqueta,
      codigoRastreamento: codigoRastreamento.trim(),
      obsEtiqueta: obsEtiqueta.trim(),
      // Sem nota autorizada o expedidor digita; havendo, `notas_fiscais`
      // vence e o manual nem e enviado — nao ha como sobrescrever o
      // numero de uma nota emitida.
      nfNumeroManual: temNotaAutorizada ? "" : nfNumeroManual.trim(),
      telefoneEtiqueta: telefoneEtiquetaParaGravar
    });
    setSalvando(false);
    return res;
  }

  async function handleSalvarRascunho() {
    if (salvando) return;
    const res = await salvarFormularioSemDespachar();
    if (!res) return;

    if (res.success) {
      showToast({
        type: "success",
        title: "Dados salvos",
        description: `#${pedido.idInt} guardado sem despachar. O pedido segue na Expedição.`
      });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível salvar", description: res.error });
    }
  }

  /**
   * Porta dos botoes SEDEX/PAC. Gerar de novo NAO cancela nos Correios e
   * sobrescreve o registro da geracao anterior — entao, quando ja ha prepostagem,
   * o operador ve os codigos e confirma antes. Sem prepostagem nao ha o que
   * perder, e gera direto: a confirmacao nao aparece.
   */
  function pedirPrepostagem(servico: "SEDEX" | "PAC") {
    if (gerandoPrepostagem || salvando) return;
    if (prepostagemCorreios) {
      setConfirmarRegeracao(servico);
      return;
    }
    void handleGerarPrepostagem(servico);
  }

  /**
   * A rota de prepostagem lê endereço/peso PERSISTIDOS em expedicoes — num
   * despacho novo a linha nem existe ainda, e mesmo editando, o que está só na
   * tela (não salvo) seria ignorado. Por isso salva o form ANTES de gerar, com
   * a mesma normalização de peso/volumes do handleConfirmar, e só chama os
   * Correios se o salvamento confirmar sucesso — o servidor sempre lê
   * exatamente o que está na tela.
   */
  async function handleGerarPrepostagem(servico: "SEDEX" | "PAC") {
    if (gerandoPrepostagem || salvando) return;
    // Emitir prepostagem E contratar transporte: passa pela MESMA porta do
    // "Confirmar despacho", nao por uma mais larga. Antes só a divergência
    // barrava aqui, e um pedido sem transportadora, sem endereço ou sem peso
    // aferido — que o botão de despachar recusava — saía preposto assim mesmo,
    // porque a rota lê do banco o que este handler acabou de gravar.
    //
    // A regra não é reescrita nem afrouxada: são as mesmas duas funções puras
    // que o rodapé consome, `camposMinimosDespacho` e `divergenciaFreteDoDespacho`.
    if (faltantes.length > 0) {
      showToast({
        type: "warning",
        title: "Prepostagem bloqueada",
        description: `Falta informar ${frasearFaltantes(faltantes)}.`
      });
      return;
    }
    if (divergencia.bloqueia) {
      showToast({
        type: "warning",
        title: "Prepostagem bloqueada",
        description: `Recote o frete antes de emitir: ${frasearMotivos(divergencia.motivosBloqueio)}.`
      });
      return;
    }
    const pesoNum = parsePesoKg(pesoKg);
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return;
    }
    const volNum = parseQtdVolumes(qtdVolumes);
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0 || volNum > 50)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes deve ser entre 1 e 50." });
      return;
    }
    // Contratar transporte com telefone invalido gravado seria pior aqui do que
    // na 10x15: e o contato que os Correios usam na entrega, e ele CONGELA.
    if (telefoneEtiquetaInvalido) {
      showToast({
        type: "error",
        title: "Telefone inválido",
        description: "Informe o telefone com DDD (ex.: (51) 99110-8552) ou apague o campo para usar o do cadastro."
      });
      return;
    }

    setGerandoPrepostagem(true);
    const salvo = await salvarDadosExpedicao(pedido.idInt, {
      modalidadeFrete: modalidade,
      tipoFrete,
      transportadoraNome: nomeTransportadoraParaGravar,
      idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      idClienteDestinatarioEtiqueta: idDestinatarioEtiqueta,
      codigoRastreamento: codigoRastreamento.trim(),
      obsEtiqueta: obsEtiqueta.trim(),
      // Sem nota autorizada o expedidor digita; havendo, `notas_fiscais`
      // vence e o manual nem e enviado — nao ha como sobrescrever o
      // numero de uma nota emitida.
      nfNumeroManual: temNotaAutorizada ? "" : nfNumeroManual.trim(),
      // A rota da prepostagem LE `telefone_etiqueta` do banco: sem isto aqui,
      // o numero digitado agora nao chegaria aos Correios.
      telefoneEtiqueta: telefoneEtiquetaParaGravar
    });
    if (!salvo.success) {
      setGerandoPrepostagem(false);
      showToast({ type: "error", title: "Não foi possível salvar antes de gerar", description: salvo.error });
      return;
    }

    const res = await gerarPrepostagem(pedido.idInt, servico);
    setGerandoPrepostagem(false);
    if (res.success && res.codigoObjeto) {
      setCodigoRastreamento(res.codigoObjeto);
      setPrepostagemGeradaAgora(true);
      showToast({ type: "success", title: "Prepostagem criada", description: `Rastreio ${res.codigoObjeto} preenchido.` });
    } else {
      showToast({ type: "error", title: "Correios recusaram a prepostagem", description: res.errorMessage });
    }
  }

  /**
   * A etiqueta deste envio, resolvida pelos valores CORRENTES do formulario.
   *
   * Nao le `pedido.*`: o expedidor pode ter acabado de trocar a modalidade, o
   * transporte ou os volumes, e o rotulo tem de sair com o que ele declarou
   * agora. `tipoEntrega === "RETIRADA"` entra como `RETIRA` porque e assim que o
   * submit grava — o mesmo `tipoFrete: "RETIRA_BALCAO"` de `handleConfirmar`.
   */
  const acaoEtiqueta = etiquetaDoPedido({
    idInt: pedido.idInt,
    modalidadeFrete: tipoEntrega === "RETIRADA" ? "RETIRA" : modalidade,
    tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,
    volumes: parseQtdVolumes(qtdVolumes),
    correiosIdPrepostagem: prepostagemGeradaAgora
      ? "GERADA_NESTA_SESSAO"
      : exp?.correiosIdPrepostagem ?? null,
    prepostagemCanceladaEm: prepostagemGeradaAgora ? null : exp?.prepostagemCanceladaEm ?? null
  });

  /**
   * GRAVA ANTES DE GERAR (04/09/2026) — o mesmo desenho da prepostagem.
   *
   * A rota do PDF le o que esta PERSISTIDO em `expedicoes`: NF manual,
   * observacao, volumes, destinatario. Ate aqui, editar um desses campos e
   * clicar em imprimir abria um PDF com os valores ANTIGOS — e agora que o
   * modal mostra a previa com o que esta na tela, papel e tela divergiriam
   * exatamente no momento em que o expedidor esta conferindo. Por isso salva
   * o formulario primeiro (`salvarFormularioSemDespachar`, o mesmo caminho do
   * "Salvar sem despachar", que NAO toca `data_despacho`) e so abre o PDF se
   * a gravacao confirmar.
   *
   * O `window.open` da etiqueta acontece depois de um `await`; os navegadores
   * ainda o aceitam dentro da janela de ativacao do clique, e se algum bloquear,
   * `abrirEtiqueta` ja cai no download por fetch — comportamento que existia.
   */
  /**
   * O objeto dos Correios que JA EXISTE para este envio — o que a conferencia
   * da prepostagem avisa que congelou (04/09/2026). Gerado nesta sessao vence
   * a foto da lista; prepostagem marcada como cancelada nao conta.
   */
  const objetoCorreiosVigente = prepostagemGeradaAgora
    ? codigoRastreamento.trim() || "gerada nesta sessão"
    : exp?.prepostagemCanceladaEm
      ? null
      : prepostagemCorreios;

  async function handleEmitirEtiqueta() {
    if (emitindoEtiqueta || salvando || acaoEtiqueta.bloqueada || faltantes.length > 0) return;
    setEmitindoEtiqueta(true);
    const salvo = await salvarFormularioSemDespachar();
    if (!salvo) {
      setEmitindoEtiqueta(false);
      return;
    }
    if (!salvo.success) {
      setEmitindoEtiqueta(false);
      showToast({ type: "error", title: "Não foi possível salvar antes de gerar", description: salvo.error });
      return;
    }
    const res = await acaoEtiqueta.abrir();
    setEmitindoEtiqueta(false);
    if (!res.success) {
      showToast({ type: "error", title: "Erro na etiqueta", description: res.errorMessage });
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
              {modoEdicao ? "Editar dados de expedição" : "Despachar pedido"} #{pedido.idInt}
            </h2>
            {/* CHIP DA MODALIDADE (04/09/2026) — somente leitura. Quem paga o
                frete se decide na proposta, nao aqui (ver `modalidadeTravada`);
                o chip diz o valor, e a origem fica no `title`. Quando NAO ha
                modalidade decidida o chip nao existe e os botoes de escolha
                continuam no corpo, como unica saida dos pedidos legados. */}
            {modalidadeInicial !== null && (
              <span
                title={`${
                  origemModalidade === "DESPACHO"
                    ? "Declarada neste despacho"
                    : origemModalidade === "COTACAO_BALCAO"
                      ? "Deduzida da cotação de balcão"
                      : "Veio do orçamento"
                }${
                  origemModalidade === "ORCAMENTO" && nomeTransportadoraOrcamento ? ` · ${nomeTransportadoraOrcamento}` : ""
                }. Quem paga o frete se decide na proposta — aqui é só leitura.`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <span className="font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Modalidade do frete:
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{LABEL_MODALIDADE[modalidadeInicial]}</span>
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* A LINHA DE CABECALHO (cliente · cidade · frete cotado) SAIU em
              04/09/2026: a previa da etiqueta logo abaixo mostra destinatario,
              cidade e forma de envio resolvidos pela mesma regra do papel. */}

          {/* PASSO 1 — Modalidade: quem paga o transporte. Comanda o resto do
              modal, mas NÃO é mais escolha da bancada: com modalidade resolvida
              ela vira o CHIP do cabeçalho e se troca na proposta. Os botões
              sobrevivem só no caso nulo — o raciocínio inteiro está em
              `modalidadeTravada`. */}
          {modalidadeInicial === null && (
            <div>
              <span className={labelClass}>Modalidade do frete</span>
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {MODALIDADES_OFERECIDAS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setModalidade(m);
                        // Sair do FOB desfaz exatamente o que a confirmação fez:
                        // devolve o transporte gravado e volta a exigir confirmação.
                        if (m !== "FOB" && confirmaTrocaCorreios) {
                          setConfirmaTrocaCorreios(false);
                          setTipoFrete("CORREIOS");
                        }
                      }}
                      className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                        modalidade === m
                          ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {LABEL_MODALIDADE[m]}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Este pedido chegou sem modalidade declarada — o normal é ela vir da proposta. Escolher aqui é
                  exceção, serve para destravar o despacho e não altera a proposta.
                </p>
                {modalidade === null && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Escolha a modalidade para liberar as opções de transportadora.
                  </p>
                )}
              </>
              {modalidade === "CIF" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  CIF aqui é só o registro de quem paga: não cota, não altera o valor da proposta e não lança nada na Conta Corrente.
                </p>
              )}
            </div>
          )}

          {/* Guarda do envio já existente nos Correios: nada é trocado sem o
              expedidor dizer que quer. */}
          {trocaCorreiosPendente && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" />
                {prepostagemCorreios
                  ? `Este envio já tem prepostagem dos Correios (${prepostagemCorreios}).`
                  : "Este pedido está definido para ir pelos Correios."}
              </p>
              <p className="mt-1.5">
                Em FOB não existe envio pelos Correios — a postagem sai pelo cartão da empresa. Confirmar troca o
                transporte para transportadora.
                {prepostagemCorreios
                  ? " A prepostagem, o código de rastreio e a etiqueta oficial continuam gravados."
                  : ""}{" "}
                {/* A saída "escolha CIF" só existe enquanto a modalidade for
                    escolhível AQUI. Travada, mandar escolher CIF orientaria um
                    clique que não existe mais — e a proposta também não resolve
                    depois de LIBERADO (`podeEditarModalidade`), então o texto diz
                    a verdade inteira em vez de empurrar o expedidor para uma
                    tela que vai recusar. */}
                {modalidadeTravada
                  ? "Se o envio realmente vai pelos Correios, quem está errada é a modalidade — e ela se corrige na proposta, só até o status LIBERADO. Passado esse ponto, confirmar aqui é o caminho, e a diferença fica registrada nas duas pontas."
                  : "Se o envio realmente vai pelos Correios, escolha CIF."}
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={confirmaTrocaCorreios}
                  onChange={(e) => {
                    setConfirmaTrocaCorreios(e.target.checked);
                    if (e.target.checked) setTipoFrete("TRANSPORTADORA");
                  }}
                  className="h-4 w-4"
                />
                Confirmo: este pedido deixa de ir pelos Correios.
              </label>
            </div>
          )}

          {/* EM NOME DE QUEM SAI A ETIQUETA — só quando ha pagador distinto.
              Sem pagador distinto o campo nem aparece e nada muda: o
              destinatario segue sendo o cliente da proposta, como sempre.
              E escolha SEPARADA do endereco. Fica ACIMA da previa desde
              04/09/2026: e o que ela reflete primeiro. */}
          {mostraEnvio && temPagadorDistinto(pedido.idCliente, pedido.idFaturado) && (
            <div>
              <label className={labelClass}>Em nome de quem sai a etiqueta</label>
              <select
                value={idDestinatarioEtiqueta ?? ""}
                onChange={(e) => setIdDestinatarioEtiqueta(e.target.value === "" ? null : Number(e.target.value))}
                className={inputClass}
              >
                <option value={String(pedido.idCliente ?? "")}>
                  {rotuloClienteComNumero(pedido.idCliente, pedido.cliente)}
                </option>
                {/* Mesmo padrao do dropdown de endereco: o numero do cadastro
                    identifica o pagador sem depender do nome. O nome curto vai
                    junto para o expedidor reconhecer quem e. */}
                <option value={String(pedido.idFaturado ?? "")}>
                  PAGADOR #{pedido.idFaturado}
                  {pedido.pagador ? ` · ${pedido.pagador}` : ""}
                </option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Vale para a etiqueta 10x15 e para a etiqueta oficial dos Correios. Na dos Correios só tem efeito se
                for definido ANTES de gerar a prepostagem — depois o nome fica congelado do lado deles.
              </p>
            </div>
          )}

          {/* TELEFONE DA ETIQUETA (04/09/2026) — `expedicoes.telefone_etiqueta`.
              Fica ao lado de "Em nome de quem": os dois falam de QUEM RECEBE, e
              os dois congelam nos Correios depois da prepostagem. Não aparece em
              RETIRA: a etiqueta de retirada não lê este campo. */}
          {mostraEnvio && acaoEtiqueta.modelo !== "RETIRADA" && (
            <div>
              <label className={labelClass}>Telefone (vai na etiqueta)</label>
              <input
                value={telefoneEtiquetaExibido}
                onChange={(e) => setTelefoneEtiqueta(e.target.value)}
                inputMode="tel"
                placeholder="Sem telefone no cadastro — digite se houver"
                className={inputClass}
                aria-invalid={telefoneEtiquetaInvalido}
              />
              {telefoneEtiquetaInvalido ? (
                <p className="mt-1 text-[11px] font-medium text-rose-700 dark:text-rose-400">
                  Isto não parece um telefone. Informe com DDD (ex.: (51) 99110-8552) ou apague o campo para usar o
                  do cadastro.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  {telefoneVeioDoCadastro
                    ? "Vem do cadastro do destinatário. Editar aqui vale só para esta remessa e não altera o cadastro do cliente."
                    : "Editado para esta remessa — o cadastro do cliente não muda. Apague o campo para voltar ao telefone do cadastro."}
                  {acaoEtiqueta.modelo === "CORREIOS"
                    ? " Na etiqueta dos Correios só tem efeito se for definido ANTES de gerar a prepostagem — depois o telefone fica congelado do lado deles."
                    : ""}
                </p>
              )}
            </div>
          )}

          {/* PRÉVIA (04/09/2026) — o modal PARECE a etiqueta.
                10x15    → a prévia do papel, bloco a bloco;
                CORREIOS → a CONFERÊNCIA da prepostagem, no MESMO desenho
                           (`EtiquetaPreview` em modo CORREIOS): o que muda é o
                           aviso de que o rótulo impresso é o oficial dos
                           Correios, e a marca "só no ERP" no que eles não
                           recebem;
                RETIRA   → sem prévia, como antes.
              Os dados e as regras são os do PDF; `vmPrevia` sobrepõe o que está
              sendo digitado, nos dois modos. */}
          {acaoEtiqueta.modelo === "RETIRADA" ? (
            <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Retira no balcão sai com a etiqueta de retirada — não há prévia da 10x15.
            </p>
          ) : (
            <div>
              {vmPrevia ? (
                <EtiquetaPreview
                  vm={vmPrevia}
                  qrDataUrl={previaBase?.qrDataUrl ?? null}
                  modo={acaoEtiqueta.modelo === "10X15" ? "10X15" : "CORREIOS"}
                  objetoTransmitido={objetoCorreiosVigente}
                />
              ) : carregandoPrevia ? (
                <div
                  className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700"
                  style={{ aspectRatio: "2 / 3" }}
                >
                  {acaoEtiqueta.modelo === "10X15"
                    ? "Montando a prévia da etiqueta..."
                    : "Montando a conferência da prepostagem..."}
                </div>
              ) : (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Não foi possível montar a prévia ({erroPrevia}). O despacho, a prepostagem e a geração do PDF
                  continuam funcionando.
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-500">
                {acaoEtiqueta.modelo === "10X15"
                  ? "Prévia da etiqueta 10x15: os campos abaixo mudam a prévia na hora. Gerar a etiqueta salva o que está na tela antes de abrir o PDF, para o papel sair igual ao que você vê aqui."
                  : "Conferência da prepostagem: os campos abaixo mudam a conferência na hora. Gerar a prepostagem salva o que está na tela antes de transmitir aos Correios."}
              </p>
            </div>
          )}

          {/* PASSO 2 em diante — modalidades de envio (FOB e CIF). Retira não
              tem transporte a definir, e o FOB pendente de confirmação fica
              fechado até o expedidor resolver a troca acima. */}
          {mostraEnvio && (
            <>
              <div>
                <label className={labelClass}>Como vai</label>
                <select value={tipoFrete} onChange={(e) => setTipoFrete(e.target.value as TipoFreteNormalizado)} className={inputClass}>
                  {TRANSPORTES_POR_MODALIDADE[modalidade].map((t) => (
                    <option key={t} value={t}>{labelTipoFrete(t)}</option>
                  ))}
                </select>
                {/* O aviso so faz sentido para quem esta escolhendo entre
                    transportes: em MOTOBOY, Correios nao esta em jogo. */}
                {modalidade === "FOB" && tipoFrete !== "MOTOBOY" && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Correios não entra em FOB: a prepostagem sai pelo cartão de postagem da empresa. Para enviar
                    pelos Correios, o pedido precisaria ser CIF
                    {modalidadeTravada ? " — e isso se decide na proposta." : ": marque CIF acima."}
                  </p>
                )}
                {TRANSPORTES_QUE_EXIGEM_TRANSPORTADORA.includes(pedido.tipoFrete) && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    O frete cotado deste pedido ({labelTipoFrete(pedido.tipoFrete)}) não diz por onde a mercadoria vai.
                    Escolha o transporte e informe a transportadora — o despacho exige, como em FOB. Nada disso altera o
                    valor do frete da proposta.
                  </p>
                )}
                {transporteRecotadoForaDaModalidade && (
                  <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                    A recotação aplicada é por {transporteRecotadoForaDaModalidade}, que esta modalidade não oferece.
                    {modalidadeTravada
                      ? " Escolha aqui como o pedido vai de fato — a modalidade não se troca nesta tela."
                      : " Ajuste a modalidade antes de confirmar, ou escolha aqui como o pedido vai de fato."}
                  </p>
                )}
              </div>

              {/* PASSO 3 — transportadora só depois de definir como vai.
                  QUEM APARECE DEPENDE DO TRANSPORTE (24/08/2026):
                    MOTOBOY       — nenhum dos dois. O meio ja e a resposta, e o
                                    nome vai derivado do servidor ("Motoboy").
                    CORREIOS      — nenhum dos dois. Quem leva e os Correios, e a
                                    transportadora sai do cartao de postagem.
                    TRANSPORTADORA — os dois, com o campo livre virando SERVICO.
                  Campos OCULTOS, nao desabilitados: desabilitado ainda ocupa
                  espaco e sugere que faltou preencher. */}
              <div className="grid gap-3 sm:grid-cols-2">
                {tipoFrete === "TRANSPORTADORA" && (
                <div>
                  <label className={labelClass}>Transportadora cadastrada</label>
                  <select
                    value={idTransportadoraCliente ?? ""}
                    onChange={(e) => {
                      const id = e.target.value === "" ? null : Number(e.target.value);
                      setIdTransportadoraCliente(id);
                      limparRecotacao();
                      const t = transportadoras.find((x) => x.id_cliente === id);
                      if (t) setTransportadoraNome(nomeExibicao(t));
                    }}
                    className={inputClass}
                  >
                    <option value="">— sem vínculo / digitar nome —</option>
                    {transportadoras.map((t) => (
                      <option key={t.id_cliente} value={t.id_cliente}>{nomeExibicao(t)}</option>
                    ))}
                  </select>
                </div>
                )}
                {/* SÓ SEM VÍNCULO (27/08/2026). Este campo já foi rotulado
                    "Serviço", com placeholder "Ex: Rodoviario, Ecomm, Aereo...",
                    e escrevia no MESMO estado do select ao lado — digitar o
                    serviço depois de escolher a transportadora apagava o nome
                    dela. O pedido 21245 saiu assim: vínculo 808 (SVT
                    TRANSPORTES) com `transportadora_nome = 'ECOMM'`, e a
                    etiqueta imprimiu ECOMM.

                    Não existe coluna para o serviço do despacho, então serviço
                    deixou de ser perguntado — em vez de continuar gravado na
                    coluna da transportadora. O campo livre sobrevive só no que
                    sempre foi seu papel legítimo: nomear transportadora que não
                    tem cadastro (3 dos 8 despachos de TRANSPORTADORA da base),
                    caso em que `camposMinimosDespacho` exige o nome. Com
                    cadastro escolhido ele some, e o nome vem de lá. */}
                {tipoFrete === "TRANSPORTADORA" && idTransportadoraCliente === null && (
                <div>
                  <label className={labelClass}>Transportadora (sem cadastro)</label>
                  <input
                    value={transportadoraNome}
                    onChange={(e) => setTransportadoraNome(e.target.value)}
                    placeholder="Nome da transportadora"
                    className={inputClass}
                  />
                </div>
                )}
              </div>
              {/* ENDEREÇO DE ENTREGA — TEXTO, não escolha (02/09/2026).
                  O select listava todos os endereços do cliente E do pagador,
                  inclusive de outras cidades, para um endereço que a proposta
                  já tinha definido. A opção "— não informar —" saiu junto: ela
                  gravava `null` e o próprio `camposMinimosDespacho` recusava o
                  despacho em seguida. */}
              <div>
                <label className={labelClass}>Endereço de entrega (vai para a etiqueta)</label>
                {pedido.enderecoEntrega ? (
                  <>
                    <p
                      className="rounded-xl border px-3 py-2 text-sm"
                      style={{
                        background: "var(--card-hover)",
                        borderColor: "var(--border)",
                        color: "var(--foreground)"
                      }}
                    >
                      {pedido.enderecoEntrega.rotulo}
                    </p>
                    {/* CPF/CNPJ e telefone DO DESTINATARIO RESOLVIDO (02/09/2026).
                        Seguem o drop acima: trocar quem recebe troca o contato na
                        hora, sem ida ao banco — os dois cadastros vem no `pedido`.
                        Sao dados de CONFERENCIA da bancada; o endereco continua
                        vindo da proposta e nao muda por causa deles. */}
                    {(contatoDestinatario.documento || contatoDestinatario.telefone) && (
                      <p className="mt-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
                        {[contatoDestinatario.documento, contatoDestinatario.telefone].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="mt-1 text-xs" style={{ color: "var(--muted-subtle)" }}>
                      {pedido.enderecoEntrega.origem === "DESPACHO"
                        ? "Endereço registrado no despacho deste pedido."
                        : "Definido na proposta. Para trocar, altere o endereço de entrega na proposta."}
                    </p>
                  </>
                ) : (
                  <p
                    className="rounded-xl border px-3 py-2 text-sm font-medium"
                    style={{
                      background: "color-mix(in srgb, var(--action-danger) 8%, transparent)",
                      borderColor: "var(--action-danger)",
                      color: "var(--action-danger)"
                    }}
                  >
                    Esta proposta não tem endereço de entrega definido. Defina o endereço na
                    proposta para poder despachar.
                  </p>
                )}
              </div>


              {/* Recotação — SÓ CONSULTA. Fica embaixo do endereço porque é dele
                  que o resultado depende. Nada aqui grava nada. */}
              {podeRecotar && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        Recotar frete {!recotacaoLiberada && <span title="Depende de liberação">🔒</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        Cota de novo com o endereço e o peso deste pedido. Frete atual da proposta:{" "}
                        <strong>{formatCurrency(pedido.freteValor ?? 0)}</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRecotar}
                      disabled={recotando || !recotacaoLiberada}
                      className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recotando ? "Cotando..." : recotacaoLiberada ? "Recotar frete" : "Bloqueado"}
                    </button>
                  </div>

                  {recotacaoLiberada ? (
                    <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                      🔓 Liberado{liberacao?.liberadoPorNome ? ` por ${liberacao.liberadoPorNome}` : ""} em{" "}
                      {new Date(liberacao!.liberadoEm).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                      {" — vale para UMA aplicação."}
                    </p>
                  ) : (
                    <p className="mt-2 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600">
                      A recotação deste pedido depende de liberação de um administrador. Peça a liberação no menu
                      <strong> Ações</strong> da lista de Expedição.
                    </p>
                  )}

                  {erroRecotacao && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                      {erroRecotacao}
                    </p>
                  )}

                  {recotacao?.success && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-500">
                        Peso usado: <strong>{((recotacao.pesoGramas ?? 0) / 1000).toFixed(2)} kg</strong>
                        {recotacao.pesoOrigem ? ` (${recotacao.pesoOrigem})` : ""} · Destino:{" "}
                        {recotacao.endereco ? `${recotacao.endereco.cidade}/${recotacao.endereco.uf}` : "—"}
                      </p>

                      {(recotacao.opcoes ?? []).map((o) => (
                        <div
                          key={o.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="text-xs">
                            <strong className="text-slate-800">{o.transportadora}</strong>
                            {o.servico ? <span className="text-slate-500"> · {o.servico}</span> : null}
                            <span className="text-slate-400"> · {o.prazo}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-slate-900">{formatCurrency(o.valor)}</span>
                            <span
                              className={
                                o.diferenca < 0
                                  ? "font-semibold text-emerald-700"
                                  : o.diferenca > 0
                                    ? "font-semibold text-amber-700"
                                    : "text-slate-400"
                              }
                            >
                              {o.diferenca === 0
                                ? "sem diferença"
                                : `${o.diferenca > 0 ? "+" : "−"}${formatCurrency(Math.abs(o.diferenca))}`}
                            </span>
                            {!o.dentroDaAlcada && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                                acima da alçada
                              </span>
                            )}
                            {podeAplicar(o) ? (
                              <button
                                type="button"
                                onClick={() => handleAplicar(o)}
                                disabled={Boolean(aplicandoId) || Boolean(aplicacao)}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                {aplicandoId === o.id ? "Aplicando..." : "Aplicar"}
                              </button>
                            ) : (
                              <span
                                title={motivoBloqueio(o)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400"
                              >
                                Aplicar
                              </span>
                            )}
                          </div>
                        </div>
                      ))}

                      {(recotacao.avisos ?? []).map((aviso, i) => (
                        <p key={i} className="text-xs italic text-slate-500">{aviso}</p>
                      ))}

                      {erroAplicacao && (
                        <p className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-medium text-rose-900">
                          {erroAplicacao}
                        </p>
                      )}

                      {aplicacao?.success ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                          <p className="font-semibold">
                            Frete atualizado{aplicacao.idempotente ? " (já estava aplicado)" : ""}
                          </p>
                          <p className="mt-1">
                            {aplicacao.transportadora}
                            {aplicacao.servico ? ` · ${aplicacao.servico}` : ""} —{" "}
                            {formatCurrency(aplicacao.freteAnterior ?? 0)} → <strong>{formatCurrency(aplicacao.freteNovo ?? 0)}</strong>{" "}
                            ({(aplicacao.diferenca ?? 0) < 0 ? "−" : ""}
                            {formatCurrency(Math.abs(aplicacao.diferenca ?? 0))})
                          </p>
                          <p>
                            Total do pedido: {formatCurrency(aplicacao.totalAnterior ?? 0)} →{" "}
                            <strong>{formatCurrency(aplicacao.totalNovo ?? 0)}</strong>
                          </p>
                          <p className="mt-2 font-semibold">
                            A diferença de {formatCurrency(Math.abs(aplicacao.diferenca ?? 0))} ainda NÃO foi lançada na
                            conta do cliente. Registrado na timeline do pedido.
                          </p>
                          <p className="mt-1">
                            A liberação foi consumida. Uma nova recotação deste pedido depende de nova liberação.
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-500">
                          Aplicar grava o frete novo na proposta e move o total pelo mesmo valor. A diferença NÃO vai
                          para a conta do cliente nesta fase.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Rastreio e coisa dos Correios: motoboy e transportadora nao
                  emitem codigo que este campo saiba tratar, e o campo aberto so
                  convidava a inventar. Valor ja gravado NAO e apagado — some da
                  tela, permanece no banco. */}
              {tipoFrete === "CORREIOS" && (
              <div>
                <label className={labelClass}>Código de rastreio (manual)</label>
                <input value={codigoRastreamento} onChange={(e) => setCodigoRastreamento(e.target.value)} placeholder="Ex.: AD173823345BR — ou gere pelos Correios na Fase 4" className={inputClass} />
              </div>
              )}
              {/* Prepostagem é sempre CIF: sai pelo cartão de postagem da
                  empresa. A modalidade entra na condição de propósito, para um
                  pedido legado marcado FOB nunca reabrir o botão. */}
              {modalidade === "CIF" && tipoFrete === "CORREIOS" && correiosOk && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={gerandoPrepostagem || salvando || faltantes.length > 0 || divergencia.bloqueia}
                      onClick={() => pedirPrepostagem("SEDEX")}
                      className="rounded-2xl bg-[#0f9f9a] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {gerandoPrepostagem ? "Gerando..." : "Gerar prepostagem SEDEX"}
                    </button>
                    <button
                      type="button"
                      disabled={gerandoPrepostagem || salvando || faltantes.length > 0 || divergencia.bloqueia}
                      onClick={() => pedirPrepostagem("PAC")}
                      className="rounded-2xl border border-[#0f9f9a] px-4 py-2 text-xs font-bold text-[#0f9f9a] transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      PAC
                    </button>
                  </div>
                  {/* Mesma ordem do rodapé: o que falta primeiro, divergência depois. */}
                  {faltantes.length > 0 ? (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Falta informar {frasearFaltantes(faltantes)}. Emitir prepostagem é contratar transporte — o mesmo
                      que o &quot;Confirmar despacho&quot; exige vale aqui.
                    </p>
                  ) : divergencia.bloqueia ? (
                    <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
                      Bloqueado: {frasearMotivos(divergencia.motivosBloqueio)}. Emitir prepostagem é contratar transporte — não
                      dá para emitir um envio que não é o que foi cotado.
                    </p>
                  ) : null}
                </div>
              )}

            </>
          )}

          {/* Divergência com o orçamento: informa, não trava. A proposta não é
              reescrita — o despacho tem a palavra final sobre o que saiu. Fica
              logo abaixo do transporte, que é o que ela compara. */}
          {(modalidadeDivergente || transportadoraDivergente) && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <p className="font-bold">Diferente do que o orçamento declarou</p>
              <ul className="mt-1.5 space-y-0.5">
                {modalidadeDivergente && pedido.modalidadeOrcamento !== null && (
                  <li>
                    Modalidade: orçamento <strong>{LABEL_MODALIDADE[pedido.modalidadeOrcamento]}</strong> · despacho{" "}
                    <strong>{modalidade !== null ? LABEL_MODALIDADE[modalidade] : "—"}</strong>
                  </li>
                )}
                {transportadoraDivergente && (
                  <li>
                    Transportadora: orçamento <strong>{nomeTransportadoraOrcamento}</strong> · despacho{" "}
                    <strong>{nomeTransportadoraParaGravar || "—"}</strong>
                  </li>
                )}
              </ul>
              <p className="mt-1.5 text-xs">
                Vale o que você declarar aqui. O orçamento não é alterado — a diferença fica registrada nas duas pontas.
              </p>
            </div>
          )}

          {/* OS CAMPOS QUE VAO NA ETIQUETA, na ordem do papel (04/09/2026):
              NF, peso, volumes e tipo numa linha; observacao embaixo. Cada um
              reflete na previa acima na hora — sem salvar, sem recarregar. */}
          <div className="grid gap-3 sm:grid-cols-[1.15fr_1fr_0.8fr_1fr]">
            <div>
              <label className={labelClass}>Nº da nota fiscal</label>
              <input
                // `?? ""` só para o TS: `temNotaAutorizada` já exige `nfNumero`
                // preenchido, mas ele não narrowa através do ternário.
                value={temNotaAutorizada ? pedido.nfNumero ?? "" : nfNumeroManual}
                onChange={(e) => setNfNumeroManual(e.target.value)}
                readOnly={temNotaAutorizada}
                placeholder={temNotaAutorizada ? "" : "Sem nota — digite se houver"}
                className={inputClass}
                style={temNotaAutorizada ? { background: "var(--card-hover)", color: "var(--muted)" } : undefined}
              />
              <p className="mt-1 text-[11px]" style={{ color: "var(--muted-subtle)" }}>
                {temNotaAutorizada
                  ? "Vem da nota emitida (NF-e autorizada) — não é editável aqui."
                  : "Este pedido não tem NF-e autorizada. O que for digitado aqui vale só para a etiqueta."}
              </p>
            </div>
            <div>
              <label className={labelClass}>Peso aferido (kg)</label>
              <input value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} inputMode="decimal" placeholder="ex.: 12,4" className={inputClass} />
              {/* O previsto saiu do placeholder: com o campo nascendo
                  preenchido, o placeholder nunca mais apareceria — e e
                  justamente agora que o expedidor precisa comparar os dois. */}
              {pedido.pesoKg !== null ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Previsto: <strong>{pedido.pesoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</strong>
                  {pedido.pesoOrigem ? ` (${pedido.pesoOrigem})` : ""}
                  {pedido.pesoRealSetoresKg !== null
                    ? ` · medido nos setores: ${pedido.pesoRealSetoresKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
                    : ""}
                </p>
              ) : null}
              {pedido.setoresSemPesoReal > 0 ? (
                <p className="mt-1 text-[11px] font-medium text-amber-700">
                  {pedido.setoresSemPesoReal} setor(es) sem peso na Revisao — a soma esta incompleta, confira na balanca.
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelClass}>Qtd. volumes</label>
              <input value={qtdVolumes} onChange={(e) => setQtdVolumes(e.target.value)} inputMode="numeric" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Tipo de volume</label>
              <select value={tipoVolume} onChange={(e) => setTipoVolume(e.target.value)} className={inputClass}>
                {TIPOS_VOLUME.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* OS DOIS CAMPOS DA ETIQUETA (02/09/2026).

              A "Observação logística (interna)" que ficava logo acima SAIU da
              tela: dois campos de observação confundiam o expedidor, e só um
              deles chegava a algum lugar — o outro gravava em `expedicoes.obs`
              e não era impresso em documento nenhum.

              A COLUNA CONTINUA NO BANCO, com o que já estava gravado. O modal
              simplesmente parou de enviá-la: `despachar` e `salvarDadosExpedicao`
              só escrevem o que recebem, então não há como apagar o que existe. */}
          <div>
            <label className={labelClass}>Observações (vão na etiqueta)</label>
            <textarea
              value={obsEtiqueta}
              onChange={(e) => setObsEtiqueta(e.target.value)}
              rows={3}
              placeholder="Ex.: PRODUTO FRÁGIL, RETIRA NO AEROPORTO ATÉ SEXTA"
              className={inputClass}
            />
            <p className="mt-1 text-[11px]" style={{ color: "var(--muted-subtle)" }}>
              Impressa no volume — lida pela transportadora e por quem recebe.
            </p>
          </div>

          {/* ETIQUETA (01/09/2026): saiu do menu de acoes da lista e passou a
              viver aqui, junto do despacho que ela documenta.

              So habilita com os campos minimos preenchidos — os MESMOS que o
              "Confirmar despacho" exige, por `camposMinimosDespacho`. Antes
              dava para imprimir o rotulo de um envio que ninguem tinha
              terminado de declarar: peso, volumes, transportadora e endereco
              em branco, e a etiqueta saindo assim mesmo.

              Em modo EDICAO `faltantes` e sempre vazio, entao o botao nasce
              habilitado — e por aqui que se reimprime a etiqueta de um pedido
              ja despachado.

              O rotulo do botao vem da propria regra de escolha do modelo, e e
              ele que avisa quando os Correios ainda nao tem prepostagem.

              LARGURA TOTAL, ABAIXO DOS CAMPOS (04/09/2026): e a acao que fecha
              o preenchimento da etiqueta, e desde esta data ela SALVA o
              formulario antes de abrir o PDF (ver `handleEmitirEtiqueta`). */}
          <div className="space-y-2">
            <button
              type="button"
              disabled={emitindoEtiqueta || salvando || acaoEtiqueta.bloqueada || faltantes.length > 0}
              onClick={() => void handleEmitirEtiqueta()}
              className="w-full rounded-2xl border-2 border-sky-400 bg-sky-100 py-4 text-lg font-bold uppercase tracking-wide text-sky-700 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60"
            >
              {emitindoEtiqueta ? "Salvando e abrindo..." : acaoEtiqueta.label}
            </button>
            {faltantes.length > 0 ? (
              <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-400">
                Falta informar {frasearFaltantes(faltantes)} para emitir a etiqueta.
              </p>
            ) : acaoEtiqueta.bloqueada ? (
              <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-400">
                O rótulo oficial dos Correios só existe depois da prepostagem — gere-a acima.
              </p>
            ) : null}
          </div>

          {precisaAvisoNf && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> Este pedido NÃO tem NF-e autorizada.
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={confirmaSemNf} onChange={(e) => setConfirmaSemNf(e.target.checked)} className="h-4 w-4" />
                Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)
              </label>
            </div>
          )}
        </div>

        {divergencia.temAviso && !modoEdicao && (
          <div
            className={
              divergencia.bloqueia
                ? "mx-5 mb-1 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                : "mx-5 mb-1 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
            }
          >
            <p className="font-semibold">
              {divergencia.bloqueia
                ? "⛔ Despacho bloqueado: este envio não é o que foi cotado"
                : "⚠ O frete cobrado pode não refletir este envio"}
            </p>
            {divergencia.transporteMudou && (
              <p className="mt-1">
                Transporte: cotado como <strong>{labelTipoFrete(divergencia.transporteReferencia!)}</strong>, despacho
                como <strong>{labelTipoFrete(tipoFrete)}</strong>.
              </p>
            )}
            {divergencia.pesoExcedeuMargem && (
              <p className="mt-1">
                Peso: {((divergencia.peso.pesoCotadoGramas ?? 0) / 1000).toFixed(2)} kg cotados contra{" "}
                {(divergencia.peso.pesoAtualGramas / 1000).toFixed(2)} kg no despacho —{" "}
                <strong>{((divergencia.percentualAcimaDoCotado ?? 0) * 100).toFixed(1)}% acima</strong> (a tolerância é{" "}
                {((divergencia.toleranciaGramas ?? 0) / 1000).toFixed(2)} kg — 200 g ou 5%, o que for maior).
              </p>
            )}
            {divergencia.cepMudou && (
              <p className="mt-1">
                Destino: cotado para o CEP {formatarCep(divergencia.cepCotado)}, despacho para{" "}
                {formatarCep(divergencia.cepDespacho)}.
              </p>
            )}
            <p className="mt-2">
              {divergencia.bloqueia ? (
                <>
                  O frete da proposta ({formatCurrency(pedido.freteValor ?? 0)}) não paga este envio. Para destravar,{" "}
                  <strong>recote e aplique</strong> uma opção — o que depende de liberação de um administrador.
                </>
              ) : divergencia.pesoExcedeuMargem ? (
                <>
                  {/* PALIATIVO 26/08/2026: peso divergente avisa e NAO trava.
                      Rever quando existir o fluxo de abono ou de cobranca da
                      diferenca — ver `divergencia-frete-despacho.ts`. */}
                  O frete da proposta (<strong>{formatCurrency(pedido.freteValor ?? 0)}</strong>) foi calculado para um
                  peso menor e <strong>pode estar defasado</strong>. O despacho segue liberado: por ora não há como
                  cobrar nem abonar a diferença, e segurar o pedido não resolveria — recotar só aceita o que barateia.
                </>
              ) : (
                <>
                  O valor na proposta continua <strong>{formatCurrency(pedido.freteValor ?? 0)}</strong> — despachar não
                  o altera.
                </>
              )}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          {!modoEdicao && (
            <button
              type="button"
              onClick={() => void handleSalvarRascunho()}
              disabled={salvando}
              className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              Salvar sem despachar
            </button>
          )}
          {faltamParaSalvar ? (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Falta informar {frasearFaltantes(faltantes)}
            </span>
          ) : divergencia.bloqueia ? (
            <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
              Bloqueado: {frasearMotivos(divergencia.motivosBloqueio)}
            </span>
          ) : null}
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando || faltamParaSalvar || divergencia.bloqueia} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-50">
            {salvando ? "Salvando..." : modoEdicao ? "Salvar dados" : tipoEntrega === "RETIRADA" ? "Confirmar: aguardando retirada" : "Confirmar despacho"}
          </button>
        </div>
      </div>
    </div>

    {confirmarRegeracao ? (
      <ConfirmarAcaoModal
        titulo="Gerar outra prepostagem?"
        descricao={`Este pedido ja tem prepostagem nos Correios. Gerar a ${confirmarRegeracao} nao cancela a atual — o cancelamento continua sendo feito por voce no portal dos Correios.`}
        detalhe={
          <span className="flex flex-col gap-1.5">
            <span>
              Passa a ser a anterior:{" "}
              <span className="select-all font-mono font-bold">{prepostagemCorreios}</span>
            </span>
            {prepostagemAnterior ? (
              <span>
                Sai do registro para sempre:{" "}
                <span className="select-all font-mono font-bold">{prepostagemAnterior}</span> — copie agora se ainda
                precisar cancelar este objeto no portal.
              </span>
            ) : (
              <span>Nenhum registro anterior sera perdido: esta e a primeira substituicao.</span>
            )}
          </span>
        }
        rotuloConfirmar={`Gerar ${confirmarRegeracao}`}
        salvando={gerandoPrepostagem}
        onConfirmar={() => {
          const servico = confirmarRegeracao;
          setConfirmarRegeracao(null);
          void handleGerarPrepostagem(servico);
        }}
        onClose={() => setConfirmarRegeracao(null)}
      />
    ) : null}
    </>
  );
}
