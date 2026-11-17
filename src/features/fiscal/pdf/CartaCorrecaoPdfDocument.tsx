import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

/**
 * PDF da carta de correção (CC-e), gerado pelo Vibe a partir do XML do evento
 * guardado (17/11/2026). O PDF da Focus só sai com o token da empresa, que fica
 * no n8n. Os campos chegam lidos e formatados pela rota
 * (lib/fiscal/carta-correcao-arquivo).
 */
export type CartaCorrecaoViewModel = {
  emitente: { nome: string; documento: string };
  destinatario: { nome: string; documento: string };
  numero: string;
  serie: string;
  chave: string;
  dataAutorizacao: string;
  sequencia: string;
  dataEvento: string;
  dataRegistro: string;
  protocolo: string;
  cStat: string;
  motivo: string;
  correcao: string;
  condicoesDeUso: string;
  ambiente: string;
  ref: string;
  geradoEm: string;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  titulo: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 3 },
  subtitulo: { fontSize: 8.5, textAlign: "center", color: "#333", marginBottom: 14 },
  bloco: { borderWidth: 1, borderColor: "#000", marginBottom: 9 },
  blocoTitulo: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#eee",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#000"
  },
  blocoCorpo: { padding: 6 },
  linha: { flexDirection: "row", marginBottom: 3 },
  rotulo: { fontSize: 7.5, color: "#333", width: 128 },
  valor: { fontSize: 9, flex: 1 },
  valorForte: { fontSize: 9, flex: 1, fontFamily: "Helvetica-Bold" },
  chave: { fontSize: 10, fontFamily: "Courier-Bold", flex: 1 },
  correcao: { fontSize: 10, lineHeight: 1.45 },
  condicoes: { fontSize: 7.5, color: "#333", lineHeight: 1.4 },
  rodape: { marginTop: 10, fontSize: 7.5, color: "#333", lineHeight: 1.4 }
});

function Linha({ rotulo, valor, forte, chave }: { rotulo: string; valor: string; forte?: boolean; chave?: boolean }) {
  return (
    <View style={styles.linha}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <Text style={chave ? styles.chave : forte ? styles.valorForte : styles.valor}>{valor || "-"}</Text>
    </View>
  );
}

function Bloco({ titulo, children, quebra }: { titulo: string; children: ReactNode; quebra?: boolean }) {
  return (
    <View style={styles.bloco} wrap={Boolean(quebra)}>
      <Text style={styles.blocoTitulo}>{titulo}</Text>
      <View style={styles.blocoCorpo}>{children}</View>
    </View>
  );
}

export function CartaCorrecaoPdfDocument({ vm }: { vm: CartaCorrecaoViewModel }) {
  return (
    <Document title={`Carta de correção ${vm.sequencia} - NF-e ${vm.numero}`} author={vm.emitente.nome}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.titulo}>Carta de Correção Eletrônica (CC-e)</Text>
        <Text style={styles.subtitulo}>Evento registrado na SEFAZ e vinculado à NF-e</Text>

        <Bloco titulo="EMITENTE">
          <Linha rotulo="Razão social" valor={vm.emitente.nome} forte />
          <Linha rotulo="CNPJ" valor={vm.emitente.documento} />
        </Bloco>

        <Bloco titulo="DESTINATÁRIO">
          <Linha rotulo="Nome / razão social" valor={vm.destinatario.nome} forte />
          <Linha rotulo="CNPJ / CPF" valor={vm.destinatario.documento} />
        </Bloco>

        <Bloco titulo="NOTA FISCAL CORRIGIDA">
          <Linha rotulo="Número / série" valor={`${vm.numero} / ${vm.serie}`} forte />
          <Linha rotulo="Chave de acesso" valor={vm.chave} chave />
          <Linha rotulo="Data de autorização" valor={vm.dataAutorizacao} />
          <Linha rotulo="Ambiente" valor={vm.ambiente} />
        </Bloco>

        <Bloco titulo="CARTA DE CORREÇÃO">
          <Linha rotulo="Sequência" valor={vm.sequencia} forte />
          <Linha rotulo="Data do pedido" valor={vm.dataEvento} />
          <Linha rotulo="Data do registro na SEFAZ" valor={vm.dataRegistro} forte />
          <Linha rotulo="Protocolo" valor={vm.protocolo} forte />
          <Linha rotulo="Situação" valor={`${vm.cStat} - ${vm.motivo}`} />
        </Bloco>

        <Bloco titulo="CORREÇÃO" quebra>
          <Text style={styles.correcao}>{vm.correcao || "-"}</Text>
        </Bloco>

        <Bloco titulo="CONDIÇÕES DE USO" quebra>
          <Text style={styles.condicoes}>{vm.condicoesDeUso || "-"}</Text>
        </Bloco>

        <Text style={styles.rodape}>
          Este documento foi gerado pelo Vibe a partir do XML do evento de carta de correção (procEventoNFe) devolvido pela
          SEFAZ. O documento com valor fiscal é o XML do evento. A situação da nota pode ser conferida pela chave de acesso
          no Portal da Nota Fiscal Eletrônica (www.nfe.fazenda.gov.br).
        </Text>
        <Text style={styles.rodape}>
          Referência {vm.ref} · gerado em {vm.geradoEm}
        </Text>
      </Page>
    </Document>
  );
}

export function criarCartaCorrecaoElement(vm: CartaCorrecaoViewModel) {
  return createElement(CartaCorrecaoPdfDocument, { vm }) as unknown as ReactElement<DocumentProps>;
}
