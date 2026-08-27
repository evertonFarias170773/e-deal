import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { OsPdfViewModel, OsPdfProduto, OsPdfModelo } from "../services/os-viewmodel.service";
import {
  OsPdfBlocoCliente,
  OsPdfCabecalho,
  coresDoSetor,
  faixaNumeracao,
  formatarData,
  formatarPeso,
  formatarQuantidade,
  OsPdfTextoMultilinha,
  pdfSafe,
  truncar,
  truncarPreservandoLinhas
} from "./OsPdfDocument";

/**
 * Segundo layout do PDF da OS: LISTA RESUMIDA, sem imagem.
 *
 * POR QUE EXISTE
 *   O layout "OS 2027" (OsPdfDocument) monta um card por modelo com a imagem
 *   grande da arte — é o papel que vai para a bancada. Quem só precisa CONFERIR
 *   os dados (quantidade, cor, faixa numérica, numerador) recebia o mesmo
 *   documento pesado. Este aqui é opcional e não substitui aquele: o padrão
 *   continua sendo o completo, e nada do outro arquivo mudou.
 *
 * O QUE MUDA, E SÓ ISSO
 *   A seção de produtos. O cabeçalho e o bloco de cliente são LITERALMENTE os
 *   mesmos componentes do layout completo (`OsPdfCabecalho` e
 *   `OsPdfBlocoCliente`, importados dali), e não uma reimplementação parecida:
 *   dois PDFs do mesmo pedido com cabeçalhos diferentes é papel que a produção
 *   não consegue conferir. Observações, forma de envio, assinaturas e rodapé
 *   repetem os mesmos campos.
 *
 * POR QUE OS FORMATADORES VÊM IMPORTADOS
 *   `faixaNumeracao`, `formatarPeso` e companhia decidem como o dado aparece.
 *   Copiá-los aqui criaria duas verdades sobre o mesmo campo — o tipo de
 *   divergência que este projeto já pagou caro. Eles foram apenas EXPORTADOS do
 *   arquivo original; nenhum corpo mudou e a saída do layout completo é a mesma.
 *
 * SEM IMAGEM, DE PROPÓSITO
 *   Nenhum `<Image>` de arte. A rota nem faz o pré-carregamento das imagens
 *   quando este layout é pedido — é daí que vem a diferença de tempo e de
 *   tamanho do arquivo. O QR e o logo continuam (identidade do documento).
 */

const styles = StyleSheet.create({
  // Identico ao do layout completo, item a item: com padding ou fonte base
  // diferentes, o mesmo componente de cabecalho cairia dois pontos acima ou
  // abaixo, e os dois PDFs do mesmo pedido nao bateriam ao serem sobrepostos.
  page: {
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 46,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111",
    flexDirection: "column"
  },




  faixaResumo: { marginBottom: 6, paddingVertical: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#ddd" },
  faixaResumoTexto: { fontSize: 7, color: "#555", fontFamily: "Helvetica-Bold", textAlign: "center" },


  produtoBloco: { marginBottom: 6 },
  produtoBarra: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 2 },
  produtoNome: { flex: 1, color: "#fff", fontSize: 9, fontFamily: "Helvetica-Bold" },
  produtoChip: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  produtoChipLabel: { color: "#fff", fontSize: 6.5, opacity: 0.85 },
  produtoChipValor: { color: "#fff", fontSize: 9, fontFamily: "Helvetica-Bold" },

  tabelaCabecalho: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#bbb", paddingVertical: 2, paddingHorizontal: 4 },
  cabecalhoTexto: { fontSize: 6, color: "#666", fontFamily: "Helvetica-Bold" },
  loteLinha: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e5e5", paddingVertical: 3, paddingHorizontal: 4, alignItems: "flex-start" },
  loteTexto: { fontSize: 8 },
  loteTextoForte: { fontSize: 8, fontFamily: "Helvetica-Bold" },

  colLote: { width: "26%", paddingRight: 4 },
  colQtd: { width: "10%", paddingRight: 4, textAlign: "right" },
  colCor: { width: "14%", paddingRight: 4 },
  colFaixa: { width: "16%", paddingRight: 4 },
  colTipo: { width: "14%", paddingRight: 4 },
  colNum: { width: "20%" },

  loteDetalhe: { paddingLeft: 8, paddingRight: 4, paddingBottom: 3 },
  loteDetalheTexto: { fontSize: 7, color: "#555" },

  // Contorno removido em 27/08/2026; o recuo horizontal saiu junto, para o
  // texto alinhar a esquerda com o resto da pagina. O vertical fica.
  obsBox: { paddingVertical: 6, marginBottom: 6 },
  // +20% em 27/08/2026: 7 -> 8.4
  obsTitulo: { fontSize: 8.4, fontFamily: "Helvetica-Bold", color: "#666", marginBottom: 2 },
  // +20% em 27/08/2026: 8 -> 9.6
  obsTexto: { fontSize: 9.6, marginBottom: 1 },

  envioBarra: { backgroundColor: "#f1f5f9", borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3, marginBottom: 8 },
  envioTexto: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#334155" },

  assinaturaArea: { flexDirection: "row", gap: 14, marginTop: 4 },
  assinatura: { flex: 1, borderTopWidth: 1, borderColor: "#999", paddingTop: 3, fontSize: 7, textAlign: "center", color: "#555" },

  footer: {
    position: "absolute",
    bottom: 16,
    left: 24,
    right: 24,
    borderTopWidth: 0.5,
    borderTopColor: "#8aa0b3",
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#5a6b7a"
  }
});

export interface OsPdfResumoDocumentProps {
  vm: OsPdfViewModel;
  qrDataUrl: string | null;
  logoDataUrl: string | null;
}

/**
 * Uma linha por lote. Prateleira esconde faixa, tipo e numerador pelo mesmo
 * motivo do card do layout completo: o produto sai pronto do estoque, não há
 * numeração nem gabarito a conferir.
 */
function LoteLinha({
  modelo,
  isEstoque,
  nomeProduto
}: {
  modelo: OsPdfModelo;
  isEstoque: boolean;
  nomeProduto: string;
}) {
  const rotuloLote = pdfSafe(isEstoque ? nomeProduto : modelo.nomeModelo) || "-";
  const impressao = `${modelo.frenteVerso ? "FxV" : "Frente"}${modelo.rfid ? "  RFID/NFC" : ""}`;
  const artes = modelo.artes
    .map((a) => pdfSafe(a.nomeArquivo))
    .filter(Boolean)
    .join(", ");

  return (
    <View wrap={false}>
      <View style={styles.loteLinha}>
        <Text style={[styles.loteTextoForte, styles.colLote]}>{rotuloLote}</Text>
        <Text style={[styles.loteTextoForte, styles.colQtd]}>{formatarQuantidade(modelo.quantidade)}</Text>
        <Text style={[styles.loteTexto, styles.colCor]}>{pdfSafe(modelo.corMaterial) || "-"}</Text>
        <Text style={[styles.loteTexto, styles.colFaixa]}>{isEstoque ? "-" : faixaNumeracao(modelo)}</Text>
        <Text style={[styles.loteTexto, styles.colTipo]}>
          {isEstoque ? "-" : pdfSafe(modelo.tipoNumeracao) || "-"}
        </Text>
        <Text style={[styles.loteTexto, styles.colNum]}>
          {isEstoque ? "-" : pdfSafe(modelo.gabarito) || "-"}
        </Text>
      </View>

      {isEstoque ? null : (
        <View style={styles.loteDetalhe}>
          <Text style={styles.loteDetalheTexto}>IMPRESSAO: {impressao}</Text>
        </View>
      )}
      {modelo.obsTecnicas ? (
        <View style={styles.loteDetalhe}>
          <Text style={styles.loteDetalheTexto}>Obs: {truncar(modelo.obsTecnicas, 160)}</Text>
        </View>
      ) : null}
      {artes ? (
        <View style={styles.loteDetalhe}>
          <Text style={styles.loteDetalheTexto}>Artes: {truncar(artes, 160)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Bloco do produto: a mesma barra de título do layout completo, e a lista. */
function ProdutoLista({ produto, corSetor }: { produto: OsPdfProduto; corSetor: string }) {
  const codigoNome = [produto.codigo, pdfSafe(produto.nome)]
    .filter((v) => v !== null && v !== "")
    .join(" - ");
  const peso = formatarPeso(produto.pesoTotalGramas);

  return (
    <View style={styles.produtoBloco}>
      {/* Barra + cabeçalho da tabela juntos: o título nunca fica órfão no fim da página. */}
      <View wrap={false}>
        <View style={[styles.produtoBarra, { backgroundColor: corSetor }]}>
          <Text style={styles.produtoNome}>{codigoNome || "Produto"}</Text>
          <View style={styles.produtoChip}>
            <Text style={styles.produtoChipLabel}>QUANT.:</Text>
            <Text style={styles.produtoChipValor}>{formatarQuantidade(produto.quantidade)}</Text>
          </View>
          {peso ? (
            <View style={styles.produtoChip}>
              <Text style={styles.produtoChipLabel}>PESO:</Text>
              <Text style={styles.produtoChipValor}>{peso}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.tabelaCabecalho}>
          <Text style={[styles.cabecalhoTexto, styles.colLote]}>LOTE / MODELO</Text>
          <Text style={[styles.cabecalhoTexto, styles.colQtd]}>QUANT.</Text>
          <Text style={[styles.cabecalhoTexto, styles.colCor]}>COR</Text>
          <Text style={[styles.cabecalhoTexto, styles.colFaixa]}>INICIAL/FINAL</Text>
          <Text style={[styles.cabecalhoTexto, styles.colTipo]}>TIPO</Text>
          <Text style={[styles.cabecalhoTexto, styles.colNum]}>NUM.</Text>
        </View>
      </View>

      {produto.modelos.map((modelo, i) => (
        <LoteLinha key={i} modelo={modelo} isEstoque={produto.isEstoque} nomeProduto={pdfSafe(produto.nome)} />
      ))}
    </View>
  );
}

export function OsPdfResumoDocument({ vm, qrDataUrl, logoDataUrl }: OsPdfResumoDocumentProps) {
  const emissao = formatarData(vm.os.emissao);
  const obsLinhas = [vm.obs.obsCriticas, vm.obs.obsImpressao, vm.obs.obsAcabamento]
    .map((t) => truncarPreservandoLinhas(t, 200))
    .filter(Boolean);
  const entregaFrete = vm.frete
    ? [vm.frete.servico, vm.frete.transportadora].filter(Boolean).join(" - ")
    : null;

  const produtosDoBoletim = vm.produtos.filter((produto) => produto.modelos.length > 0);
  const cores = coresDoSetor(vm.boletim.setor);
  const somenteEstoque =
    produtosDoBoletim.length > 0 && produtosDoBoletim.every((produto) => produto.isEstoque);

  return (
    <Document
      title={`OS ${vm.idInt} - resumo`}
      author={vm.empresa.nome}
      subject="Boletim de Producao / Ordem de Servico (lista resumida)"
    >
      <Page size="A4" style={styles.page}>
        <OsPdfCabecalho vm={vm} qrDataUrl={qrDataUrl} logoDataUrl={logoDataUrl} />

        {/* Diz o que este papel é. Sem isto, quem recebe a folha na bancada acha
            que a OS veio sem as artes. */}
        <View style={styles.faixaResumo}>
          <Text style={styles.faixaResumoTexto}>
            LISTA RESUMIDA - CONFERENCIA DE DADOS - SEM IMAGEM DAS ARTES
          </Text>
        </View>

        <OsPdfBlocoCliente vm={vm} somenteEstoque={somenteEstoque} />

        {produtosDoBoletim.map((produto, i) => (
          <ProdutoLista key={i} produto={produto} corSetor={cores.forte} />
        ))}

        {/* Orientacao tecnica de producao (`propostas.obs_tecnica`) — a
            instrucao que a bancada segue. Sai INTEIRA: sem o corte de 200
            caracteres dos outros campos, e sem `wrap={false}`, para um texto
            longo quebrar entre paginas em vez de ser cortado na renderizacao. */}
        <View style={styles.obsBox}>
          <Text style={styles.obsTitulo}>Orientação técnica de produção:</Text>
          <OsPdfTextoMultilinha valor={vm.obsTecnica} estilo={styles.obsTexto} />
        </View>

        <View style={styles.obsBox} wrap={false}>
          <Text style={styles.obsTitulo}>Observações:</Text>
          {obsLinhas.length > 0 ? (
            obsLinhas.map((linha, i) => (
              <OsPdfTextoMultilinha key={i} valor={linha} estilo={styles.obsTexto} />
            ))
          ) : (
            <Text style={styles.obsTexto}>-</Text>
          )}
        </View>

        <View style={styles.envioBarra} wrap={false}>
          <Text style={styles.envioTexto}>Forma de envio: {pdfSafe(entregaFrete) || "-"}</Text>
        </View>

        <View style={styles.assinaturaArea} wrap={false}>
          <View style={styles.assinatura}>
            <Text>Producao</Text>
          </View>
          <View style={styles.assinatura}>
            <Text>Conferencia</Text>
          </View>
          <View style={styles.assinatura}>
            <Text>Responsavel</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>OS #{vm.idInt} - resumo</Text>
          <Text render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} de ${totalPages}`} />
          <Text>Emitido em {emissao}</Text>
        </View>
      </Page>
    </Document>
  );
}
