import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { EtiquetaRetiradaViewModel } from "../services/etiqueta-retirada-viewmodel.service";

// Mesmo 100 x 150 mm das outras etiquetas (1 mm = 2.83465 pt).
const LARGURA = 283.46;
const ALTURA = 425.2;

/**
 * Etiqueta da RETIRA NO BALCAO.
 *
 * A hierarquia e outra porque a pergunta e outra. Na 10x15 de envio, cidade e
 * CEP mandam, porque quem le e a transportadora triando carga. Aqui quem le e o
 * atendente com um cliente na frente dizendo um numero de pedido: entao o NUMERO
 * domina a etiqueta, o titulo diz de longe o que aquele pacote esta esperando, e
 * o telefone existe para cobrar quem sumiu.
 *
 * Sem endereco, transportadora, rastreio, peso e QR — nenhum tem uso no balcao.
 */
const styles = StyleSheet.create({
  page: { width: LARGURA, height: ALTURA, padding: 8, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  moldura: { flex: 1, borderWidth: 2, borderColor: "#000", borderRadius: 8, padding: 8 },

  titulo: { fontSize: 19, fontFamily: "Helvetica-Bold", letterSpacing: 0.5, textAlign: "center" },
  tituloBarra: { borderBottomWidth: 2, borderColor: "#000", paddingBottom: 6, marginBottom: 8 },

  bloco: { borderWidth: 1.5, borderColor: "#000", borderRadius: 5, padding: 6, marginBottom: 6 },
  blocoCliente: { flexGrow: 1 },
  legenda: { fontSize: 6.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.4, color: "#000" },

  // O maior elemento da etiqueta: é o que o cliente fala ao chegar.
  pedidoNumero: { fontSize: 52, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 2, marginBottom: 2 },

  clienteNome: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2, lineHeight: 1.25 },
  telefone: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 6 },

  linhaDupla: { flexDirection: "row", gap: 6 },
  meia: { flex: 1 },
  valorDestaque: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 2 },
  valorData: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 2 },

  rodape: { marginTop: "auto", borderTopWidth: 1, borderColor: "#000", paddingTop: 4 },
  rodapeTexto: { fontSize: 7, fontFamily: "Helvetica-Bold" }
});

export function EtiquetaRetiradaPdfDocument({ vm }: { vm: EtiquetaRetiradaViewModel }) {
  // Uma página por volume, no mesmo padrão "n/total" das outras etiquetas.
  const paginas = Array.from({ length: vm.volumes }, (_, i) => i + 1);

  return (
    <Document title={`Retirada ${vm.idInt}`}>
      {paginas.map((n) => (
        <Page key={n} size={{ width: LARGURA, height: ALTURA }} style={styles.page}>
          <View style={styles.moldura}>
            <View style={styles.tituloBarra}>
              <Text style={styles.titulo}>AGUARDANDO RETIRADA</Text>
            </View>

            <View style={styles.bloco}>
              <Text style={styles.legenda}>PEDIDO</Text>
              <Text style={styles.pedidoNumero}>{vm.idInt}</Text>
            </View>

            <View style={[styles.bloco, styles.blocoCliente]}>
              <Text style={styles.legenda}>CLIENTE</Text>
              <Text style={styles.clienteNome}>{vm.cliente.nome}</Text>
              {vm.cliente.telefone ? <Text style={styles.telefone}>{vm.cliente.telefone}</Text> : null}
            </View>

            <View style={styles.linhaDupla}>
              <View style={[styles.bloco, styles.meia]}>
                <Text style={styles.legenda}>VOLUME</Text>
                <Text style={styles.valorDestaque}>
                  {n}/{vm.volumes}
                </Text>
              </View>
              <View style={[styles.bloco, styles.meia]}>
                <Text style={styles.legenda}>PRONTO EM</Text>
                <Text style={styles.valorData}>{vm.prontoEm || "—"}</Text>
              </View>
            </View>

            <View style={styles.rodape}>
              <Text style={styles.rodapeTexto}>{vm.remetenteRodape}</Text>
            </View>
          </View>
        </Page>
      ))}
    </Document>
  );
}

/** Fábrica usada pela rota — mesmo padrão (e mesmo cast) de `criarEtiquetaElement`. */
export function criarEtiquetaRetiradaElement(vm: EtiquetaRetiradaViewModel) {
  return createElement(EtiquetaRetiradaPdfDocument, { vm }) as unknown as ReactElement<DocumentProps>;
}
