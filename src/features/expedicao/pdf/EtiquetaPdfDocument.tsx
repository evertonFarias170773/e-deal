import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";
import { codificarCode128B } from "./code128";

// 100 x 150 mm em pontos (1 mm = 2.83465 pt)
const LARGURA = 283.46;
const ALTURA = 425.2;

/** Margem de impressão da página, em pontos. Mantida do layout anterior. */
const PADDING_PAGINA = 8;
/** Borda e respiro internos da moldura — entram no cálculo da área das barras. */
const MOLDURA_BORDA = 2;
const MOLDURA_PADDING = 8;

/**
 * Largura útil para o código de barras: a página menos as margens de impressão,
 * a borda da moldura e o respiro interno dos dois lados.
 */
const LARGURA_BARRAS =
  LARGURA - 2 * PADDING_PAGINA - 2 * MOLDURA_BORDA - 2 * MOLDURA_PADDING;

const ALTURA_BARRAS = 46;

/**
 * ############################################################################
 * # PENDENTE DE DEFINIÇÃO — CÓDIGO DE BARRAS FICTÍCIO                        #
 * ############################################################################
 *
 * Valor FIXO, igual para toda etiqueta. NÃO é o rastreio do pedido: enquanto a
 * regra de numeração não estiver definida, imprimir `vm.codigoRastreamento`
 * daria um símbolo que a transportadora tentaria bipar e recusaria — pior do
 * que um placeholder que ninguém confunde com o real.
 *
 * PARA TROCAR, MEXA SÓ AQUI: dê um parâmetro `vm: EtiquetaViewModel` a
 * `conteudoCodigoBarras` e devolva `vm.codigoRastreamento` (ou o campo que vier)
 * no lugar da constante. A chamada única já está no corpo do componente, com o
 * `vm` em escopo — o desenho, a largura do módulo e o texto sob as barras se
 * ajustam sozinhos ao novo tamanho.
 */
const CODIGO_BARRAS_FICTICIO = "VP20928000144790BR";

/** Ponto único de origem do símbolo. Ver o bloco PENDENTE acima. */
function conteudoCodigoBarras(): string {
  return CODIGO_BARRAS_FICTICIO;
}

/**
 * Documento do destinatário com os extremos escondidos: `***.559.859-**`.
 *
 * A etiqueta viaja colada no volume e é lida por qualquer um que manuseie a
 * carga. O documento serve para o entregador CONFERIR contra o que o
 * destinatário apresenta — para isso o miolo basta, e o número inteiro exposto
 * no papel não. Esconde os 3 primeiros e os 2 últimos dígitos, preservando a
 * pontuação de CPF ou CNPJ.
 *
 * Texto que não seja CPF nem CNPJ volta como veio: mascarar o que não se
 * reconhece produziria lixo em vez de proteção.
 */
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

/** Rótulo do documento pelo tamanho — o destinatário pode ser pessoa ou empresa. */
function rotuloDocumento(formatado: string): string {
  const n = formatado.replace(/\D/g, "").length;
  if (n === 11) return "CPF";
  if (n === 14) return "CNPJ";
  return "DOC";
}

/**
 * Cidade e UF separadas a partir de `cidadeUf`.
 *
 * O view model entrega "Rio Grande - RS" (ou o `cidade_uf` cru do cadastro, no
 * fallback). O layout aprovado empilha as duas em corpo grande, então a divisão
 * acontece aqui — na APRESENTAÇÃO — em vez de abrir dois campos novos no view
 * model, que a Declaração de Conteúdo também consome.
 *
 * Sem separador reconhecível, tudo vira cidade e a UF sai vazia: melhor a linha
 * inteira legível do que um pedaço arbitrário promovido a estado.
 */
function separarCidadeUf(cidadeUf: string): { cidade: string; uf: string } {
  const texto = String(cidadeUf ?? "").trim();
  if (!texto) return { cidade: "", uf: "" };

  const m = texto.match(/^(.*?)\s*[-/·]\s*([A-Za-z]{2})$/) ?? texto.match(/^(.*?)\s+([A-Za-z]{2})$/);
  if (m) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: texto, uf: "" };
}

/**
 * Etiqueta 10x15 — layout tipográfico aprovado em 26/08/2026.
 *
 * HIERARQUIA, e para quem ela foi feita
 *   Quem manuseia o volume não leu a proposta: precisa saber PARA ONDE vai e
 *   QUAL pedido é. Por isso PEDIDO/VOLUME abrem a etiqueta, CIDADE/UF e CEP
 *   dominam o miolo em corpo grande, e o código de barras fecha embaixo, onde a
 *   mão do conferente naturalmente aponta o leitor.
 *
 * O QUE SAIU
 *   O PESO deixou a etiqueta nesta revisão. Ele continua no view model, porque
 *   a Declaração de Conteúdo o imprime — o que mudou é que a etiqueta parou de
 *   repetir um dado que a transportadora confere na balança dela, não no papel.
 *
 * SEPARAÇÃO POR RÉGUAS, não por caixas
 *   O layout anterior emoldurava cada bloco. Réguas horizontais dão a mesma
 *   separação gastando menos altura e menos tinta térmica, e deixam o texto
 *   respirar — numa 10x15 a borda dupla come milímetros que fazem falta ao nome
 *   e ao endereço.
 */
const styles = StyleSheet.create({
  page: {
    width: LARGURA,
    height: ALTURA,
    padding: PADDING_PAGINA,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#000"
  },
  /**
   * Altura FIXA, não `flex: 1`.
   *
   * A etiqueta é um objeto físico de 10x15 — a moldura tem de ocupar
   * exatamente a folha, sem depender de quanto texto veio. Com altura fixa e
   * `overflow: hidden`, conteúdo excedente é cortado dentro da moldura em vez
   * de empurrar o react-pdf a abrir uma segunda folha (o que acontecia com o
   * 21110) ou a encolher a página ao conteúdo (o que `wrap={false}` provocava,
   * devolvendo 100x140mm em vez de 100x150mm).
   */
  moldura: {
    height: ALTURA - 2 * PADDING_PAGINA,
    borderWidth: MOLDURA_BORDA,
    borderColor: "#000",
    borderRadius: 10,
    padding: MOLDURA_PADDING,
    overflow: "hidden"
  },

  // Cabeçalho: remetente à esquerda, transportadora à direita.
  cabecalho: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cabecalhoTexto: { fontSize: 7.5, letterSpacing: 0.7, flexShrink: 1, paddingRight: 6 },
  cabecalhoTransp: { fontSize: 7.5, letterSpacing: 0.7, textAlign: "right" },

  reguaGrossa: { borderBottomWidth: 1.6, borderBottomColor: "#000", marginTop: 7, marginBottom: 7 },
  reguaFina: { borderBottomWidth: 0.8, borderBottomColor: "#000", marginTop: 7, marginBottom: 7 },

  // PEDIDO / VOLUME
  linhaTopo: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  colEsq: { flexShrink: 1 },
  colDir: { alignItems: "flex-end" },
  rotulo: { fontSize: 7, letterSpacing: 1.1, marginBottom: 2 },
  numeroGrande: { fontSize: 30, fontFamily: "Helvetica-Bold", lineHeight: 1 },

  // Destinatário.
  // `maxLines` + ellipsis em toda linha de texto livre: numa etiqueta de tamanho
  // FIXO, um nome longo não pode empurrar o CEP e o código de barras para fora.
  // O 21110 ("47 - IMPRIZIL SISTEMAS DE IDENTIFICACAO E IMPRESSOS DE SEGURANCA
  // LTDA") transbordava e o react-pdf abria uma segunda folha por volume.
  destNome: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
    lineHeight: 1.15,
    maxLines: 2,
    textOverflow: "ellipsis"
  },
  destLinha: { fontSize: 10, lineHeight: 1.35, maxLines: 2, textOverflow: "ellipsis" },
  destDoc: { fontSize: 8.5, letterSpacing: 0.3, marginTop: 5, maxLines: 1 },

  // Cidade / UF
  cidade: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
    maxLines: 2,
    textOverflow: "ellipsis"
  },
  uf: { fontSize: 26, fontFamily: "Helvetica-Bold", lineHeight: 1.1, maxLines: 1 },

  // CEP
  cepValor: { fontSize: 24, fontFamily: "Helvetica-Bold", lineHeight: 1 },

  // Código de barras
  areaBarras: { marginTop: "auto" },
  barras: { flexDirection: "row", height: ALTURA_BARRAS, alignItems: "stretch" },
  barraPreta: { backgroundColor: "#000" },
  barraBranca: { backgroundColor: "#fff" },
  barrasTexto: {
    fontSize: 9,
    letterSpacing: 1.6,
    textAlign: "center",
    marginTop: 5
  },

  rodape: { fontSize: 7.5, letterSpacing: 0.5, marginTop: 8 }
});

/** Desenha o símbolo como retângulos: barra preta e espaço branco alternados. */
function CodigoDeBarras({ valor }: { valor: string }) {
  const simbolo = codificarCode128B(valor);
  if (!simbolo) return null;

  const larguraModulo = LARGURA_BARRAS / simbolo.totalModulos;

  return (
    <View style={styles.areaBarras}>
      <View style={styles.barras}>
        {simbolo.modulos.map((larguraEmModulos, i) => (
          <View
            key={i}
            style={[
              i % 2 === 0 ? styles.barraPreta : styles.barraBranca,
              { width: larguraEmModulos * larguraModulo }
            ]}
          />
        ))}
      </View>
      <Text style={styles.barrasTexto}>{valor}</Text>
    </View>
  );
}

export function EtiquetaPdfDocument({ vm }: { vm: EtiquetaViewModel; qrDataUrl?: string | null }) {
  const paginas = Array.from({ length: vm.volumes }, (_, i) => i + 1);
  const { cidade, uf } = separarCidadeUf(vm.destinatario.cidadeUf);
  const valorBarras = conteudoCodigoBarras();

  const documento = vm.destinatario.documento
    ? `${rotuloDocumento(vm.destinatario.documento)} ${mascararDocumento(vm.destinatario.documento)}`
    : "";
  const telefone = vm.destinatario.telefone ? `Fone ${vm.destinatario.telefone}` : "";
  const docELinha = [documento, telefone].filter(Boolean).join("   ·   ");

  /**
   * Rodapé: NF-e e embalagem, cada trecho só quando existe.
   *
   * Sem nota, o trecho da NF-e SOME — não vira `000.000.000`, traço nem "sem
   * nota". O placeholder era um número com cara de número: quem confere na doca
   * lê zeros e não sabe se a nota falta ou se saiu errada. Ausência é a
   * informação mais honesta, e a linha continua com o resto.
   */
  const rodape = [vm.nfNumero ? `NF-e ${vm.nfNumero}` : "", vm.tipoVolume ? `Embalagem: ${vm.tipoVolume}` : ""]
    .filter(Boolean)
    .join("   ·   ");

  return (
    <Document title={`Etiqueta ${vm.idInt}`}>
      {paginas.map((n) => (
        <Page key={n} size={{ width: LARGURA, height: ALTURA }} style={styles.page}>
          <View style={styles.moldura}>
            <View style={styles.cabecalho}>
              <Text style={styles.cabecalhoTexto}>{vm.remetenteRodape.toUpperCase()}</Text>
              <Text style={styles.cabecalhoTransp}>
                {(vm.transportadora || "A DEFINIR").toUpperCase()}
              </Text>
            </View>

            <View style={styles.reguaGrossa} />

            <View style={styles.linhaTopo}>
              <View style={styles.colEsq}>
                <Text style={styles.rotulo}>PEDIDO</Text>
                <Text style={styles.numeroGrande}>{vm.idInt}</Text>
              </View>
              <View style={styles.colDir}>
                <Text style={styles.rotulo}>VOLUME</Text>
                <Text style={styles.numeroGrande}>
                  {n}/{vm.volumes}
                </Text>
              </View>
            </View>

            <View style={styles.reguaFina} />

            <Text style={styles.rotulo}>DESTINATÁRIO</Text>
            <Text style={styles.destNome}>{vm.destinatario.nome}</Text>
            {vm.destinatario.recebedor ? (
              <Text style={styles.destLinha}>A/C: {vm.destinatario.recebedor}</Text>
            ) : null}
            {vm.destinatario.endereco ? (
              <Text style={styles.destLinha}>{vm.destinatario.endereco}</Text>
            ) : null}
            {vm.destinatario.bairro ? (
              <Text style={styles.destLinha}>{vm.destinatario.bairro}</Text>
            ) : null}
            {docELinha ? <Text style={styles.destDoc}>{docELinha}</Text> : null}

            <View style={styles.reguaFina} />

            {cidade ? <Text style={styles.cidade}>{cidade}</Text> : null}
            {uf ? <Text style={styles.uf}>{uf}</Text> : null}

            <View style={styles.reguaFina} />

            <Text style={styles.rotulo}>CEP</Text>
            <Text style={styles.cepValor}>{vm.destinatario.cep || "—"}</Text>

            <View style={styles.reguaGrossa} />

            <CodigoDeBarras valor={valorBarras} />

            {rodape ? <Text style={styles.rodape}>{rodape}</Text> : null}
          </View>
        </Page>
      ))}
    </Document>
  );
}

/**
 * Fábrica usada pela rota (mesmo padrão createElement do imprimir-os,
 * incluindo o cast: props do componente não têm nada em comum com
 * DocumentProps aos olhos do TS, mesmo o retorno em runtime sendo um
 * <Document>).
 *
 * `qrDataUrl` continua na assinatura e é aceito pelo componente sem ser
 * desenhado: o layout aprovado não tem QR. Mantido para NÃO tocar na rota, que
 * segue gerando e passando o valor — trocar a assinatura obrigaria a mexer em
 * `/api/expedicao/etiqueta`, fora do escopo desta mudança.
 */
export function criarEtiquetaElement(vm: EtiquetaViewModel, qrDataUrl: string | null) {
  return createElement(EtiquetaPdfDocument, { vm, qrDataUrl }) as unknown as ReactElement<DocumentProps>;
}
