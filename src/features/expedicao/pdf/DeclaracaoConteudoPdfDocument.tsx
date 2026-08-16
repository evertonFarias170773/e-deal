import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { DeclaracaoViewModel, ParteDeclaracao } from "../services/declaracao-viewmodel.service";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  titulo: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 2 },
  subtitulo: { fontSize: 8, textAlign: "center", color: "#333", marginBottom: 12 },

  bloco: { borderWidth: 1, borderColor: "#000", marginBottom: 8 },
  blocoTitulo: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#eee",
    paddingVertical: 3,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#000"
  },
  blocoCorpo: { padding: 5 },
  linha: { flexDirection: "row", marginBottom: 2 },
  rotulo: { fontSize: 7.5, color: "#333", width: 62 },
  valor: { fontSize: 8.5, flex: 1 },

  tabelaCabecalho: {
    flexDirection: "row",
    backgroundColor: "#eee",
    borderBottomWidth: 1,
    borderBottomColor: "#000"
  },
  tabelaLinha: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#999" },
  celIndice: { width: 26, padding: 4, fontSize: 8 },
  celDescricao: { flex: 1, padding: 4, fontSize: 8 },
  celQtd: { width: 52, padding: 4, fontSize: 8, textAlign: "right" },
  celValor: { width: 66, padding: 4, fontSize: 8, textAlign: "right" },
  celCabecalho: { fontFamily: "Helvetica-Bold", fontSize: 7.5 },

  totais: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
  totalRotulo: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginRight: 8 },
  totalValor: { fontSize: 8.5, fontFamily: "Helvetica-Bold", width: 66, textAlign: "right" },

  declaracao: { fontSize: 7.5, lineHeight: 1.45, marginTop: 12, textAlign: "justify" },
  assinatura: { marginTop: 34, alignItems: "center" },
  linhaAssinatura: { borderTopWidth: 1, borderTopColor: "#000", width: 260, paddingTop: 3 },
  textoAssinatura: { fontSize: 7.5, textAlign: "center" },
  rodape: { marginTop: "auto", fontSize: 6.5, color: "#555", textAlign: "center" }
});

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Parte({ titulo, parte }: { titulo: string; parte: ParteDeclaracao }) {
  return (
    <View style={styles.bloco}>
      <Text style={styles.blocoTitulo}>{titulo}</Text>
      <View style={styles.blocoCorpo}>
        <View style={styles.linha}>
          <Text style={styles.rotulo}>Nome</Text>
          <Text style={styles.valor}>{parte.nome || "—"}</Text>
        </View>
        <View style={styles.linha}>
          <Text style={styles.rotulo}>CPF/CNPJ</Text>
          <Text style={styles.valor}>{parte.documento || "—"}</Text>
        </View>
        <View style={styles.linha}>
          <Text style={styles.rotulo}>Endereço</Text>
          <Text style={styles.valor}>{parte.endereco || "—"}</Text>
        </View>
        <View style={styles.linha}>
          <Text style={styles.rotulo}>Bairro</Text>
          <Text style={styles.valor}>{parte.bairro || "—"}</Text>
        </View>
        <View style={styles.linha}>
          <Text style={styles.rotulo}>Cidade/UF</Text>
          <Text style={styles.valor}>
            {parte.cidadeUf || "—"}
            {parte.cep ? `   ·   CEP ${parte.cep}` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function DeclaracaoConteudoPdfDocument({ vm }: { vm: DeclaracaoViewModel }) {
  // Linhas em branco para preenchimento à mão quando o pedido tem poucos itens
  // (avulsa costuma vir sem nenhum): o formulário precisa ser utilizável no balcão.
  const vazias = Math.max(0, 8 - vm.itens.length);

  return (
    <Document title={`Declaracao de Conteudo ${vm.idInt}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.titulo}>DECLARAÇÃO DE CONTEÚDO</Text>
        <Text style={styles.subtitulo}>Pedido #{vm.idInt}</Text>

        <Parte titulo="REMETENTE" parte={vm.remetente} />
        <Parte titulo="DESTINATÁRIO" parte={vm.destinatario} />

        <View style={styles.bloco}>
          <Text style={styles.blocoTitulo}>DISCRIMINAÇÃO DO CONTEÚDO</Text>

          <View style={styles.tabelaCabecalho}>
            <Text style={[styles.celIndice, styles.celCabecalho]}>ITEM</Text>
            <Text style={[styles.celDescricao, styles.celCabecalho]}>DESCRIÇÃO</Text>
            <Text style={[styles.celQtd, styles.celCabecalho]}>QTD.</Text>
            <Text style={[styles.celValor, styles.celCabecalho]}>VALOR (R$)</Text>
          </View>

          {vm.itens.map((item, i) => (
            <View key={`${item.discriminacao}-${i}`} style={styles.tabelaLinha}>
              <Text style={styles.celIndice}>{i + 1}</Text>
              <Text style={styles.celDescricao}>{item.discriminacao}</Text>
              <Text style={styles.celQtd}>{item.quantidade}</Text>
              <Text style={styles.celValor}>{dinheiro(item.valorTotal)}</Text>
            </View>
          ))}

          {Array.from({ length: vazias }, (_, i) => (
            <View key={`vazia-${i}`} style={styles.tabelaLinha}>
              <Text style={styles.celIndice}>{vm.itens.length + i + 1}</Text>
              <Text style={styles.celDescricao}> </Text>
              <Text style={styles.celQtd}> </Text>
              <Text style={styles.celValor}> </Text>
            </View>
          ))}
        </View>

        <View style={styles.totais}>
          <Text style={styles.totalRotulo}>TOTAL DE ITENS</Text>
          <Text style={styles.totalValor}>{vm.totalQuantidade || "—"}</Text>
        </View>
        <View style={styles.totais}>
          <Text style={styles.totalRotulo}>PESO TOTAL (KG)</Text>
          <Text style={styles.totalValor}>{vm.pesoKg || "—"}</Text>
        </View>
        <View style={styles.totais}>
          <Text style={styles.totalRotulo}>VALOR TOTAL (R$)</Text>
          <Text style={styles.totalValor}>{dinheiro(vm.totalValor)}</Text>
        </View>

        <Text style={styles.declaracao}>
          Declaro que não me enquadro no conceito de contribuinte previsto no art. 4º da Lei Complementar
          nº 87/1996, uma vez que não realizo, com habitualidade ou em volume que caracterize intuito
          comercial, operações de circulação de mercadoria, ainda que se iniciem no exterior, ou estou
          dispensado da emissão da nota fiscal por força da legislação tributária vigente,
          responsabilizando-me, nos termos da lei e a quem de direito, por informações inverídicas.
        </Text>
        <Text style={styles.declaracao}>
          Declaro ainda que o conteúdo desta remessa não é constituído por, nem contém, substância ou
          artigo perigoso proibido pela legislação ou pelas normas postais.
        </Text>

        <View style={styles.assinatura}>
          <Text style={styles.textoAssinatura}>
            {[vm.cidadeEmissao, "______ de __________________ de 20____"].filter(Boolean).join(", ")}
          </Text>
          <View style={{ height: 30 }} />
          <View style={styles.linhaAssinatura}>
            <Text style={styles.textoAssinatura}>Assinatura do remetente</Text>
          </View>
        </View>

        <Text style={styles.rodape}>
          Documento gerado pelo sistema para acompanhar a remessa sem nota fiscal. Confira os dados antes de assinar.
        </Text>
      </Page>
    </Document>
  );
}

/** Mesmo padrão de createElement/cast usado em criarEtiquetaElement. */
export function criarDeclaracaoElement(vm: DeclaracaoViewModel) {
  return createElement(DeclaracaoConteudoPdfDocument, { vm }) as unknown as ReactElement<DocumentProps>;
}
