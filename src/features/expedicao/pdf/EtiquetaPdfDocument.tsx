import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";

// 100 x 150 mm em pontos (1 mm = 2.83465 pt)
const LARGURA = 283.46;
const ALTURA = 425.2;

/**
 * Etiqueta 10x15 em blocos emoldurados.
 *
 * Hierarquia pensada para quem manuseia o volume, não para quem vendeu: CIDADE
 * e CEP são o que a transportadora usa para triar, então dominam a etiqueta. O
 * remetente vale uma linha no rodapé — ninguém separa carga por remetente.
 * NF-e e PEDIDO ficam no topo, grandes, porque são a chave de conferência na
 * doca. Blocos preenchem a altura toda: sobra em branco vira dúvida de "faltou
 * imprimir alguma coisa?".
 */
const styles = StyleSheet.create({
  page: { width: LARGURA, height: ALTURA, padding: 8, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  moldura: { flex: 1, borderWidth: 2, borderColor: "#000", borderRadius: 8, padding: 6 },

  titulo: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 4, letterSpacing: 0.5 },

  bloco: { borderWidth: 1.5, borderColor: "#000", borderRadius: 5, padding: 5, marginBottom: 4 },
  blocoCheio: { flexGrow: 1 },
  legenda: { fontSize: 6.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.4, color: "#000" },

  topoLinha: { flexDirection: "row" },
  topoCol: { flex: 1 },
  topoColDireita: { flex: 1, alignItems: "flex-end" },
  numeroGrande: { fontSize: 21, fontFamily: "Helvetica-Bold", marginTop: -1 },

  destNome: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  destLinha: { fontSize: 8.5, lineHeight: 1.3 },
  destBairro: { fontSize: 8, marginTop: 2 },
  destCidade: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 6 },
  destCep: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: "auto" },
  destRodape: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  destRodapeTexto: { fontSize: 7.5 },

  transpNome: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 1, marginBottom: 3 },
  colunas: { flexDirection: "row" },
  coluna: { flex: 1 },
  colunaRotulo: { fontSize: 6.5, color: "#333" },
  colunaValor: { fontSize: 8.5, fontFamily: "Helvetica-Bold" },

  rastreioLinha: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 },
  rastreioValor: { fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 0.6 },

  obsTexto: { fontSize: 8, marginTop: 1 },

  rodape: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 2 },
  rodapeTexto: { fontSize: 7, fontFamily: "Helvetica-Bold", flex: 1 },
  qr: { width: 40, height: 40 }
});

export function EtiquetaPdfDocument({
  vm,
  qrDataUrl
}: {
  vm: EtiquetaViewModel;
  qrDataUrl: string | null;
}) {
  const paginas = Array.from({ length: vm.volumes }, (_, i) => i + 1);

  return (
    <Document title={`Etiqueta ${vm.idInt}`}>
      {paginas.map((n) => (
        <Page key={n} size={{ width: LARGURA, height: ALTURA }} style={styles.page}>
          <View style={styles.moldura}>
            <Text style={styles.titulo}>DESTINATÁRIO</Text>

            {/* NF-e e pedido: chave de conferência na doca. */}
            <View style={styles.bloco}>
              <View style={styles.topoLinha}>
                <View style={styles.topoCol}>
                  <Text style={styles.legenda}>NF-E</Text>
                  <Text style={styles.numeroGrande}>{vm.nfNumero || "—"}</Text>
                </View>
                <View style={styles.topoColDireita}>
                  <Text style={styles.legenda}>PEDIDO</Text>
                  <Text style={styles.numeroGrande}>{vm.idInt}</Text>
                </View>
              </View>
            </View>

            {/* Bloco principal: cresce para ocupar a altura livre. */}
            <View style={[styles.bloco, styles.blocoCheio]}>
              <Text style={styles.destNome}>{vm.destinatario.nome}</Text>
              {vm.destinatario.recebedor ? (
                <Text style={styles.destLinha}>A/C: {vm.destinatario.recebedor}</Text>
              ) : null}
              {vm.destinatario.endereco ? (
                <Text style={styles.destLinha}>{vm.destinatario.endereco}</Text>
              ) : null}
              {vm.destinatario.bairro ? (
                <Text style={styles.destBairro}>BAIRRO: {vm.destinatario.bairro}</Text>
              ) : null}
              {vm.destinatario.cidadeUf ? (
                <Text style={styles.destCidade}>{vm.destinatario.cidadeUf.toUpperCase()}</Text>
              ) : null}

              {vm.destinatario.cep ? <Text style={styles.destCep}>CEP {vm.destinatario.cep}</Text> : null}

              <View style={styles.destRodape}>
                <Text style={styles.destRodapeTexto}>
                  {vm.destinatario.documento ? `CNPJ/CPF: ${vm.destinatario.documento}` : " "}
                </Text>
                <Text style={styles.destRodapeTexto}>
                  {vm.destinatario.telefone ? `Fone: ${vm.destinatario.telefone}` : " "}
                </Text>
              </View>
            </View>

            {/* Transporte: transportadora, volume, embalagem, peso e rastreio. */}
            <View style={styles.bloco}>
              <Text style={styles.legenda}>TRANSPORTADORA</Text>
              <Text style={styles.transpNome}>{vm.transportadora || "A DEFINIR"}</Text>
              <View style={styles.colunas}>
                <View style={styles.coluna}>
                  <Text style={styles.colunaRotulo}>Volumes</Text>
                  <Text style={styles.colunaValor}>
                    {n}/{vm.volumes}
                  </Text>
                </View>
                <View style={styles.coluna}>
                  <Text style={styles.colunaRotulo}>Embalagem</Text>
                  <Text style={styles.colunaValor}>{vm.tipoVolume || "—"}</Text>
                </View>
                <View style={styles.coluna}>
                  <Text style={styles.colunaRotulo}>Peso bruto</Text>
                  <Text style={styles.colunaValor}>{vm.pesoKg ? `${vm.pesoKg} kg` : "—"}</Text>
                </View>
              </View>
              {vm.codigoRastreamento ? (
                <View style={styles.rastreioLinha}>
                  <Text style={styles.colunaRotulo}>Rastreio</Text>
                  <Text style={styles.rastreioValor}>{vm.codigoRastreamento}</Text>
                </View>
              ) : null}
            </View>

            {vm.obs ? (
              <View style={styles.bloco}>
                <Text style={styles.legenda}>OBSERVAÇÃO DE TRANSPORTE</Text>
                <Text style={styles.obsTexto}>{vm.obs}</Text>
              </View>
            ) : null}

            {/* Remetente em uma linha, com o QR do pedido para conferência interna. */}
            <View style={styles.rodape}>
              <Text style={styles.rodapeTexto}>{vm.remetenteRodape.toUpperCase()}</Text>
              {qrDataUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={qrDataUrl} style={styles.qr} />
              ) : null}
            </View>
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
 */
export function criarEtiquetaElement(vm: EtiquetaViewModel, qrDataUrl: string | null) {
  return createElement(EtiquetaPdfDocument, { vm, qrDataUrl }) as unknown as ReactElement<DocumentProps>;
}
