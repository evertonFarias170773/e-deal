import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

/**
 * PDF do comprovante de cancelamento de NF-e (16/11/2026), gerado pelo Vibe a
 * partir do XML do evento guardado. A Focus não gera esse PDF. Os campos chegam
 * já lidos e formatados pela rota (lib/fiscal/comprovante-cancelamento).
 */
export type ComprovanteCancelamentoViewModel = {
  emitente: { nome: string; documento: string };
  destinatario: { nome: string; documento: string };
  numero: string;
  serie: string;
  chave: string;
  dataAutorizacao: string;
  protocoloAutorizacao: string;
  dataEvento: string;
  dataRegistro: string;
  protocoloCancelamento: string;
  cStat: string;
  motivo: string;
  justificativa: string;
  ambiente: string;
  ref: string;
  geradoEm: string;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
  titulo: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 3 },
  subtitulo: { fontSize: 8.5, textAlign: "center", color: "#333", marginBottom: 14 },
  selo: {
    alignSelf: "center",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#9f1239",
    borderWidth: 1.5,
    borderColor: "#9f1239",
    paddingVertical: 4,
    paddingHorizontal: 12,
    marginBottom: 14
  },
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

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={styles.bloco} wrap={false}>
      <Text style={styles.blocoTitulo}>{titulo}</Text>
      <View style={styles.blocoCorpo}>{children}</View>
    </View>
  );
}

export function ComprovanteCancelamentoPdfDocument({ vm }: { vm: ComprovanteCancelamentoViewModel }) {
  return (
    <Document title={`Comprovante de cancelamento - NF-e ${vm.numero}`} author={vm.emitente.nome}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.titulo}>Comprovante de cancelamento de NF-e</Text>
        <Text style={styles.subtitulo}>Evento de cancelamento registrado na SEFAZ</Text>
        <Text style={styles.selo}>NF-e CANCELADA</Text>

        <Bloco titulo="EMITENTE">
          <Linha rotulo="Razão social" valor={vm.emitente.nome} forte />
          <Linha rotulo="CNPJ" valor={vm.emitente.documento} />
        </Bloco>

        <Bloco titulo="DESTINATÁRIO">
          <Linha rotulo="Nome / razão social" valor={vm.destinatario.nome} forte />
          <Linha rotulo="CNPJ / CPF" valor={vm.destinatario.documento} />
        </Bloco>

        <Bloco titulo="NOTA FISCAL CANCELADA">
          <Linha rotulo="Número / série" valor={`${vm.numero} / ${vm.serie}`} forte />
          <Linha rotulo="Chave de acesso" valor={vm.chave} chave />
          <Linha rotulo="Data de autorização" valor={vm.dataAutorizacao} />
          <Linha rotulo="Protocolo de autorização" valor={vm.protocoloAutorizacao} />
          <Linha rotulo="Ambiente" valor={vm.ambiente} />
        </Bloco>

        <Bloco titulo="CANCELAMENTO">
          <Linha rotulo="Data do pedido" valor={vm.dataEvento} />
          <Linha rotulo="Data do registro na SEFAZ" valor={vm.dataRegistro} forte />
          <Linha rotulo="Protocolo do cancelamento" valor={vm.protocoloCancelamento} forte />
          <Linha rotulo="Situação" valor={`${vm.cStat} - ${vm.motivo}`} />
          <Linha rotulo="Justificativa" valor={vm.justificativa} />
        </Bloco>

        <Text style={styles.rodape}>
          Este comprovante foi gerado pelo Vibe a partir do XML do evento de cancelamento (procEventoNFe) devolvido pela
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

export function criarComprovanteCancelamentoElement(vm: ComprovanteCancelamentoViewModel) {
  return createElement(ComprovanteCancelamentoPdfDocument, { vm }) as unknown as ReactElement<DocumentProps>;
}
