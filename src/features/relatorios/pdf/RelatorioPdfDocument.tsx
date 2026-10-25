import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ColunaPdf, ModeloPdf } from "../types";

/**
 * Documento PDF genérico de relatório (24/10/2026) — base dos relatórios financeiros em PDF.
 *
 * Recebe um `ModeloPdf` já com todo o texto formatado (a definição do relatório monta o
 * modelo) e desenha: cabeçalho (título, empresa, período, filtros, critério), uma tabela por
 * seção com subtotal, o resumo e o rodapé fixo ("Gerado em ... por ...", página n de m).
 * Nada aqui conhece pagamento, nota ou boleto: relatório novo só monta outro `ModeloPdf`.
 * As linhas não quebram no meio e a paginação é automática.
 */

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 28, fontSize: 8, fontFamily: "Helvetica", color: "#111" },
  titulo: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  linhaInfo: { fontSize: 8.5, marginBottom: 2 },
  rotulo: { fontFamily: "Helvetica-Bold" },
  criterio: { fontSize: 7, color: "#444", marginTop: 4, marginBottom: 10, lineHeight: 1.35 },
  secaoTitulo: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 1 },
  secaoNota: { fontSize: 7, color: "#555", marginBottom: 3 },
  cabecalho: { flexDirection: "row", backgroundColor: "#e8e8e8", borderBottomWidth: 1, borderBottomColor: "#444" },
  celulaCabecalho: { fontFamily: "Helvetica-Bold", fontSize: 7.5, paddingVertical: 3, paddingHorizontal: 3 },
  linha: { flexDirection: "row", borderBottomWidth: 0.4, borderBottomColor: "#bbb" },
  celula: { fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3, borderTopWidth: 1, borderTopColor: "#444", paddingTop: 3 },
  subtotalRotulo: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginRight: 10 },
  subtotalValor: { fontFamily: "Helvetica-Bold", fontSize: 8.5, width: 90, textAlign: "right" },
  resumo: { marginTop: 14, borderTopWidth: 1.5, borderTopColor: "#111", paddingTop: 6 },
  resumoTitulo: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  resumoLinha: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  resumoDestaque: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  rodape: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#555" }
});

function alinhar(coluna: ColunaPdf) {
  return { flex: coluna.largura, textAlign: coluna.alinhamento ?? "left" } as const;
}

function RelatorioPdfDocument({ modelo }: { modelo: ModeloPdf }) {
  return (
    <Document title={modelo.titulo} author={modelo.geradoPor} creator="Vibe">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.titulo}>{modelo.titulo}</Text>
        <Text style={styles.linhaInfo}>
          <Text style={styles.rotulo}>Empresa: </Text>
          {modelo.empresa}
        </Text>
        <Text style={styles.linhaInfo}>
          <Text style={styles.rotulo}>Período: </Text>
          {modelo.periodo}
        </Text>
        {modelo.filtros.length > 0 ? (
          <Text style={styles.linhaInfo}>
            <Text style={styles.rotulo}>Filtros: </Text>
            {modelo.filtros.join(" · ")}
          </Text>
        ) : null}
        <Text style={styles.criterio}>{modelo.criterio}</Text>

        {modelo.secoes.map((secao) => (
          <View key={secao.titulo}>
            <Text style={styles.secaoTitulo} minPresenceAhead={60}>
              {secao.titulo}
            </Text>
            {secao.nota ? <Text style={styles.secaoNota}>{secao.nota}</Text> : null}
            {/* `fixed`: o cabeçalho da tabela se repete em cada página da seção (ex.: PIX com ~21 páginas). */}
            <View style={styles.cabecalho} fixed>
              {secao.colunas.map((c) => (
                <Text key={c.titulo} style={[styles.celulaCabecalho, alinhar(c)]}>
                  {c.titulo}
                </Text>
              ))}
            </View>
            {secao.linhas.map((linha, i) => (
              <View key={i} style={styles.linha} wrap={false}>
                {linha.map((texto, j) => (
                  <Text key={j} style={[styles.celula, alinhar(secao.colunas[j])]}>
                    {texto}
                  </Text>
                ))}
              </View>
            ))}
            {secao.subtotal ? (
              <View style={styles.subtotal} wrap={false}>
                <Text style={styles.subtotalRotulo}>{secao.subtotal.rotulo}</Text>
                <Text style={styles.subtotalValor}>{secao.subtotal.valor}</Text>
              </View>
            ) : null}
          </View>
        ))}

        <View style={styles.resumo} wrap={false}>
          <Text style={styles.resumoTitulo}>Resumo</Text>
          {modelo.resumo.map((r) => (
            <View key={r.rotulo} style={styles.resumoLinha}>
              <Text style={r.destaque ? styles.resumoDestaque : undefined}>{r.rotulo}</Text>
              <Text style={r.destaque ? styles.resumoDestaque : undefined}>{r.valor}</Text>
            </View>
          ))}
        </View>

        <View style={styles.rodape} fixed>
          <Text>
            Gerado em {modelo.geradoEm} por {modelo.geradoPor}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Elemento pronto para `renderToBuffer` (a rota não precisa de JSX). */
export function criarRelatorioPdfElement(modelo: ModeloPdf): ReactElement<DocumentProps> {
  return createElement(RelatorioPdfDocument, { modelo }) as unknown as ReactElement<DocumentProps>;
}
