import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";
import {
  ETIQUETA_ALTURA_PT,
  ETIQUETA_LARGURA_PT,
  ETIQUETA_PADDING_PT,
  apresentacaoEtiqueta
} from "../lib/etiqueta-apresentacao";

// 100 x 150 mm em pontos (1 mm = 2.83465 pt). Os numeros vivem em
// `lib/etiqueta-apresentacao.ts` desde 04/09/2026, compartilhados com a
// previa HTML do modal Despachar — o papel e a tela medem o mesmo.
const LARGURA = ETIQUETA_LARGURA_PT;
const ALTURA = ETIQUETA_ALTURA_PT;

/** Margem de impressão da página, nos quatro lados. */
const PADDING_PAGINA = ETIQUETA_PADDING_PT;

/**
 * ALTURA EXPLÍCITA DA MOLDURA — o que garante que ela vá até o pé (03/09/2026).
 *
 * Era `flexGrow: 1` sem altura, e não funcionava: `flexGrow` reparte o espaço
 * LIVRE do container, e a `Page` com `wrap={false}` não oferece uma altura
 * definida para repartir. Sem espaço livre para distribuir, a moldura encolhia
 * até o conteúdo — no 21409, que não tem observação, ela fechava a ~83% da área
 * e deixava a faixa branca embaixo. E o `espacador` lá dentro herdava o mesmo
 * problema: dentro de uma caixa que já era do tamanho do conteúdo, não havia
 * folga alguma para ele absorver.
 *
 * Com a altura em pontos absolutos — não porcentagem, que esta versão do
 * react-pdf não resolve de forma confiável — a moldura passa a ter uma altura
 * DEFINIDA, o `espacador` ganha folga real para comer, e o rodapé encosta no pé
 * em qualquer cenário.
 */
const ALTURA_MOLDURA = ALTURA - 2 * PADDING_PAGINA;

/**
 * Documento do destinatário com os extremos escondidos: `***.559.859-**`.
 *
 * SEM CHAMADOR desde 02/09/2026: o layout aprovado lista o bloco do
 * destinatário como nome, endereço, bairro e telefone — o documento saiu. As
 * duas funções ficam porque a regra de mascaramento é decisão de privacidade,
 * não formatação: reconstruí-la depois custaria mais do que mantê-la aqui.
 *
 * A etiqueta viaja colada no volume e é lida por qualquer um que manuseie a
 * carga. O documento serve para o entregador CONFERIR contra o que o
 * destinatário apresenta — para isso o miolo basta, e o número inteiro exposto
 * no papel não. Esconde os 3 primeiros e os 2 últimos dígitos, preservando a
 * pontuação de CPF ou CNPJ.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mascararDocumento(formatado: string): string {
  const digitos = formatado.replace(/\D/g, "");
  if (digitos.length !== 11 && digitos.length !== 14) return formatado;

  const oculto = digitos
    .split("")
    .map((d, i) => (i < 3 || i >= digitos.length - 2 ? "*" : d));

  if (digitos.length === 11) {
    const [a, b, c, d] = [oculto.slice(0, 3), oculto.slice(3, 6), oculto.slice(6, 9), oculto.slice(9)];
    return `${a.join("")}.${b.join("")}.${c.join("")}-${d.join("")}`;
  }
  const [a, b, c, d, e] = [
    oculto.slice(0, 2),
    oculto.slice(2, 5),
    oculto.slice(5, 8),
    oculto.slice(8, 12),
    oculto.slice(12)
  ];
  return `${a.join("")}.${b.join("")}.${c.join("")}/${d.join("")}-${e.join("")}`;
}

/** Rótulo do documento pelo tamanho. Sem chamador — ver `mascararDocumento`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function rotuloDocumento(formatado: string): string {
  const n = formatado.replace(/\D/g, "").length;
  if (n === 11) return "CPF";
  if (n === 14) return "CNPJ";
  return "DOC";
}

/**
 * `separarCidadeUf` e `cortarObservacao` (e o limite de 105 caracteres da
 * observacao) SAIRAM DAQUI em 04/09/2026 para `lib/etiqueta-apresentacao.ts`,
 * com o raciocinio inteiro documentado la. Motivo: a previa HTML do modal
 * Despachar precisa aplicar exatamente as mesmas regras, e este arquivo
 * importa `@react-pdf/renderer`, que nao pode ir para o bundle do browser.
 * Nada mudou nas regras — so o endereco.
 */

/**
 * Etiqueta 10x15 — layout de 02/09/2026, conforme a referência do dono.
 *
 * HIERARQUIA, e para quem ela foi feita
 *   Quem manuseia o volume não leu a proposta: precisa saber QUAL pedido é e
 *   PARA ONDE vai. Por isso PEDIDO abre a etiqueta em corpo enorme, e CEP e
 *   CIDADE/UF dominam o miolo — são o que o conferente procura na esteira.
 *
 * SEPARAÇÃO POR RÉGUAS, não por caixas
 *   Réguas horizontais separam gastando menos altura e menos tinta térmica que
 *   molduras, e deixam o texto respirar — numa 10x15 a borda dupla come
 *   milímetros que fazem falta ao nome do destinatário.
 *
 * O QUE SAIU NESTA REVISÃO
 *   - O CÓDIGO DE BARRAS. Era um valor FIXO e fictício, igual em toda etiqueta,
 *     esperando uma regra de numeração que nunca veio. A transportadora tentava
 *     bipar e recusava. `code128.ts` continua no repositório, sem chamador;
 *     nenhum outro documento o usa (conferido em 02/09/2026).
 *   - O DOCUMENTO do destinatário (CPF/CNPJ mascarado). O bloco passou a ser
 *     nome, endereço, bairro e telefone, conforme a referência. As funções de
 *     mascaramento ficaram, sem chamador — ver o comentário delas.
 *   - O PESO, que já havia saído em 26/08/2026.
 *
 * O QUE ENTROU
 *   OBSERVAÇÕES (de `expedicoes.obs_etiqueta`, NUNCA de `obs`, que é interna),
 *   REMETENTE completo do cadastro em `empresas`, DATA DE ENVIO, e o QR do site
 *   — que a rota já gerava e o componente descartava desde 26/08.
 *
 * UMA PÁGINA POR VOLUME, como sempre: `VOLUME 1/2`, `2/2`, e assim por diante.
 *
 * REVISAO DE 04/09/2026 — duas correcoes de CONTEUDO, layout preservado:
 *   - NOTA FISCAL voltou ao lado de PEDIDO, em duas colunas na mesma linha
 *     ("—" sem nota, como CEP e cidade ja faziam);
 *   - Fone imprime o TELEFONE: a regra `whatsapp_1 || telefone_fixo` pegava o
 *     primeiro campo preenchido, e no cadastro 248 ele guardava o nome do
 *     cliente. Ver `lib/telefone-destinatario.ts`.
 *   Este documento passou a ter uma PREVIA em HTML no modal Despachar
 *   (`components/EtiquetaPreview.tsx`), que le o mesmo view model e as mesmas
 *   regras de apresentacao. O PDF continua sendo o artefato impresso.
 */
const styles = StyleSheet.create({
  pagina: {
    width: LARGURA,
    height: ALTURA,
    padding: PADDING_PAGINA,
    fontFamily: "Helvetica",
    color: "#000000"
  },
  moldura: {
    // Altura DEFINIDA, não `flexGrow` — ver `ALTURA_MOLDURA`. É o que dá ao
    // `espacador` uma folga real para absorver e ao rodapé um pé onde encostar.
    height: ALTURA_MOLDURA,
    borderWidth: 2,
    borderColor: "#000000",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    overflow: "hidden"
  },

  /** Rótulo de seção: pequeno, preto, caixa alta. */
  rotulo: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 0.6 },
  /** Régua entre blocos — 1.5pt lê bem em térmica sem borrar. */
  regua: { borderBottomWidth: 1.5, borderBottomColor: "#000000", marginVertical: 3.5 },

  pedidoLinha: { flexDirection: "row", alignItems: "flex-start" },
  /**
   * PEDIDO e NOTA FISCAL lado a lado (04/09/2026): duas colunas de largura
   * igual, o pedido a esquerda e a nota a direita. O corpo caiu de 38 para 36pt
   * para uma NF de 7 digitos caber ao lado de um pedido de 5 na largura util
   * (~243pt) sem estourar.
   */
  pedidoColuna: { flexGrow: 1, flexBasis: 0 },
  pedidoNumero: {
    fontSize: 36,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -1
  },

  destNome: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 1.5 },
  destLinha: { fontSize: 10, marginTop: 1.2 },

  grande: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 1 },
  envio: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 2 },

  obsTexto: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
    lineHeight: 1.2,
    // Teto de altura junto do corte por caracteres: se a medição de
    // texto do react-pdf discordar da minha conta, o layout ainda segura.
    maxHeight: 24,
    overflow: "hidden"
  },

  remLinha: { fontSize: 9, marginTop: 1.2 },

  /**
   * `flexShrink: 0` impede que o rodape seja espremido quando o conteudo acima
   * cresce — sem ele, e o primeiro a ceder, e foi o que quebrou para a segunda
   * pagina. Quem o empurra para o pe e o `espacador` acima, nao mais um
   * `marginTop: auto` que esta versao do react-pdf nao honrava.
   */
  rodape: { flexDirection: "row", alignItems: "flex-end", flexShrink: 0 },
  rodapeColuna: { flexDirection: "column" },
  qr: { width: 40, height: 40, marginTop: 2 },
  dataValor: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 2 },
  volumeValor: { fontSize: 26, fontFamily: "Helvetica-Bold", textAlign: "right" },

  /**
   * ESPAÇADOR — é ELE que encosta o rodapé no pé da página.
   *
   * `marginTop: "auto"` não segurou nesta versão do react-pdf: o rodapé ficava
   * logo abaixo do remetente e o que sobrava da altura virava espaço morto no
   * fim. Um `View` com `flexGrow: 1` entre o conteúdo e o rodapé é o jeito
   * canônico e à prova de versão: ele come toda a folga disponível e some
   * sozinho (`flexShrink`) quando o conteúdo é longo.
   */
  espacador: { flexGrow: 1 },

  /**
   * TETO DO BLOCO DO DESTINATÁRIO — o único que varia de verdade.
   *
   * Endereço de duas linhas, A/C presente, nome longo: é aqui que o conteúdo
   * cresce. Com o teto, o excesso é recortado NESTE bloco, e não no rodapé —
   * perder o fim de um complemento é ruim, perder o QR e o volume é pior.
   *
   * 80pt cobrem nome + A/C + endereço em duas linhas + bairro + telefone.
   */
  destBloco: { maxHeight: 80, overflow: "hidden" }
});

export function EtiquetaPdfDocument({
  vm,
  qrDataUrl
}: {
  vm: EtiquetaViewModel;
  qrDataUrl?: string | null;
}) {
  const paginas = Array.from({ length: vm.volumes }, (_, i) => i + 1);
  // As linhas derivadas vem de `lib/etiqueta-apresentacao.ts` — a MESMA funcao
  // que a previa do modal Despachar usa. Papel e tela nao podem discordar
  // sobre o que sai impresso.
  const a = apresentacaoEtiqueta(vm);

  return (
    <Document title={`Etiqueta ${vm.idInt}`}>
      {/* `wrap={false}` na Page E A GARANTIA ESTRUTURAL: sem ele o react-pdf
          PAGINA o conteudo que excede a altura util, e foi o que aconteceu no
          21503 — os rotulos SITE/DATA/VOLUME ficaram na primeira folha e os
          valores na segunda, num pedido de volume 1/1. Nao havia `<Page>` a
          mais: era UMA pagina cujo conteudo quebrou. Com a flag, o excedente e
          recortado dentro da moldura em vez de virar folha nova, e a promessa
          "uma pagina por volume" passa a valer com qualquer conteudo. */}
      {paginas.map((n) => (
        <Page key={n} size={{ width: LARGURA, height: ALTURA }} style={styles.pagina} wrap={false}>
          <View style={styles.moldura}>
            {/* CADA BLOCO E UM `View wrap={false}`: assim um rotulo nunca se
                separa do seu valor, nem entre si nem do resto. Era exatamente o
                sintoma do 21503 no rodape. */}
            <View wrap={false} style={styles.pedidoLinha}>
              <View style={styles.pedidoColuna}>
                <Text style={styles.rotulo}>PEDIDO:</Text>
                <Text style={styles.pedidoNumero}>{vm.idInt}</Text>
              </View>
              <View style={[styles.pedidoColuna, { alignItems: "flex-end" }]}>
                <Text style={styles.rotulo}>NOTA FISCAL:</Text>
                <Text style={styles.pedidoNumero}>{a.nfExibida}</Text>
              </View>
            </View>
            <View style={styles.regua} />

            <View wrap={false} style={styles.destBloco}>
              <Text style={styles.rotulo}>DESTINATÁRIO:</Text>
              <Text style={styles.destNome}>{vm.destinatario.nome}</Text>
              {vm.destinatario.recebedor ? (
                <Text style={styles.destLinha}>A/C: {vm.destinatario.recebedor}</Text>
              ) : null}
              {vm.destinatario.endereco ? (
                <Text style={styles.destLinha}>{vm.destinatario.endereco}</Text>
              ) : null}
              {vm.destinatario.bairro ? (
                <Text style={styles.destLinha}>BAIRRO: {vm.destinatario.bairro}</Text>
              ) : null}
              {a.telefoneLinha ? <Text style={styles.destLinha}>{a.telefoneLinha}</Text> : null}
            </View>
            <View style={styles.regua} />

            <View wrap={false}>
              <Text style={styles.rotulo}>CEP:</Text>
              <Text style={styles.grande}>{a.cepExibido}</Text>
            </View>
            <View style={styles.regua} />

            <View wrap={false}>
              <Text style={styles.rotulo}>CIDADE/UF:</Text>
              <Text style={styles.grande}>{a.cidadeUfLinha}</Text>
            </View>
            <View style={styles.regua} />

            <View wrap={false}>
              <Text style={styles.rotulo}>FORMA DE ENVIO:</Text>
              <Text style={styles.envio}>{a.transportadoraExibida}</Text>
            </View>
            <View style={styles.regua} />

            {/* OBSERVAÇÕES — `obs_etiqueta`, o campo do modal que é IMPRESSO.
                Nunca `vm.obs`, que é o recado interno da bancada.

                `maxLines` protege a altura: numa 10x15 uma observação longa
                empurraria o remetente e o rodapé para fora do papel. Três linhas
                cobrem o caso real ("PRODUTO FRÁGIL, RETIRA NO AEROPORTO DE
                CONGONHAS, ATÉ MEIO DIA DE SEXTA DIA 04/09") com folga. */}
            {a.observacaoImpressa ? (
              <>
                <View wrap={false}>
                  <Text style={styles.rotulo}>OBSERVAÇÕES:</Text>
                  <Text style={styles.obsTexto}>{a.observacaoImpressa}</Text>
                </View>
                <View style={styles.regua} />
              </>
            ) : null}

            <View wrap={false}>
              <Text style={styles.rotulo}>REMETENTE:</Text>
              <Text style={styles.remLinha}>{vm.remetente.nome}</Text>
              {vm.remetente.logradouro ? (
                <Text style={styles.remLinha}>{vm.remetente.logradouro}</Text>
              ) : null}
              {vm.remetente.bairroCidadeUf ? (
                <Text style={styles.remLinha}>{vm.remetente.bairroCidadeUf}</Text>
              ) : null}
            </View>

            {/* O ESPAÇADOR come a folga e encosta o rodapé no pé. Sem ele, a
                sobra de altura — que varia de pedido para pedido, conforme o
                endereço tenha uma ou duas linhas e haja ou não observação —
                virava espaço morto no fim da etiqueta. */}
            <View style={styles.espacador} />

            {/* RODAPÉ — SITE (QR), DATA DE ENVIO e VOLUME. */}
            <View wrap={false} style={styles.rodape}>
              <View style={[styles.rodapeColuna, { width: 60 }]}>
                <Text style={styles.rotulo}>SITE:</Text>
                {/* `Image` aqui é o do `@react-pdf/renderer`, não um `<img>`:
                    ele desenha no PDF e não aceita `alt` (nem existe leitor de
                    tela lendo etiqueta térmica). A regra de a11y é para o DOM. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                {qrDataUrl ? <Image src={qrDataUrl} style={styles.qr} /> : null}
              </View>
              <View style={[styles.rodapeColuna, { flexGrow: 1, alignItems: "center" }]}>
                <Text style={styles.rotulo}>DATA DE ENVIO:</Text>
                <Text style={styles.dataValor}>{vm.dataEnvio}</Text>
              </View>
              <View style={[styles.rodapeColuna, { width: 62, alignItems: "flex-end" }]}>
                <Text style={styles.rotulo}>VOLUME:</Text>
                <Text style={styles.volumeValor}>
                  {n}/{vm.volumes}
                </Text>
              </View>
            </View>
          </View>
        </Page>
      ))}
    </Document>
  );
}

/**
 * Fábrica usada pela rota (mesmo padrão createElement do imprimir-os, incluindo
 * o cast: props do componente não têm nada em comum com DocumentProps aos olhos
 * do TS, mesmo o retorno em runtime sendo um <Document>).
 *
 * `qrDataUrl` era aceito e DESCARTADO desde 26/08/2026, porque o layout de então
 * não tinha QR. Desde 02/09/2026 ele é desenhado no rodapé, e a rota não mudou
 * de assinatura — só o endereço que ela codifica.
 */
export function criarEtiquetaElement(vm: EtiquetaViewModel, qrDataUrl: string | null) {
  return createElement(EtiquetaPdfDocument, { vm, qrDataUrl }) as unknown as ReactElement<DocumentProps>;
}
