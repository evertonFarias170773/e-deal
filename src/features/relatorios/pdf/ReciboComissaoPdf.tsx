import { createElement } from "react";
import type { ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

/**
 * Recibo de pagamento de comissão (03/11/2026), A4, gerado no servidor com @react-pdf/renderer
 * (a mesma base dos PDFs de relatório). Recebe tudo já formatado; não consulta nada.
 * Forma e data do pagamento em branco viram linha para preencher à mão.
 */

export type ModeloRecibo = {
  /** `endereco`: uma linha por item (rua e bairro; cidade e CEP). */
  empresa: { razaoSocial: string; cnpj: string; endereco: string[]; logo: string | null };
  vendedor: string;
  periodo: string;
  base: string;
  qtdPedidos: string;
  totalVendas: string;
  percentual: string;
  comissao: string;
  forma: string | null;
  dataPagamento: string | null;
  /** "Porto Alegre, 5 de novembro de 2026" ou só a cidade, para completar à mão. */
  local: { cidade: string; dataExtenso: string | null };
  geradoEm: string;
  geradoPor: string;
};

const TINTA = "#0f172a";
const CINZA = "#475569";
const CLARO = "#94a3b8";
const LINHA = "#cbd5e1";
const FUNDO = "#f1f5f9";

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 52, fontFamily: "Helvetica", fontSize: 10, color: TINTA },
  topo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logo: { maxHeight: 58, maxWidth: 170, objectFit: "contain" },
  emitente: { alignItems: "flex-end", maxWidth: 290 },
  emitenteNome: { fontFamily: "Helvetica-Bold", fontSize: 10.5, textAlign: "right" },
  emitenteInfo: { fontSize: 8.5, color: CINZA, marginTop: 2, textAlign: "right" },
  regua: { marginTop: 16, height: 2.5, backgroundColor: TINTA },
  reguaFina: { marginTop: 2, height: 0.6, backgroundColor: TINTA },
  titulo: { marginTop: 26, fontFamily: "Helvetica-Bold", fontSize: 20, letterSpacing: 0.2 },
  subtitulo: { marginTop: 4, fontSize: 10, color: CINZA },
  destaque: {
    marginTop: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    backgroundColor: FUNDO,
    borderLeftWidth: 4,
    borderLeftColor: TINTA,
    paddingVertical: 16,
    paddingHorizontal: 18
  },
  destaqueRotulo: { fontSize: 8.5, color: CINZA, textTransform: "uppercase", letterSpacing: 1 },
  destaqueValor: { marginTop: 4, fontFamily: "Helvetica-Bold", fontSize: 28 },
  destaqueConta: { fontSize: 9.5, color: CINZA, textAlign: "right" },
  destaqueContaForte: { fontFamily: "Helvetica-Bold", color: TINTA },
  secao: { marginTop: 24, fontSize: 8.5, color: CINZA, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  linha: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINHA, paddingVertical: 7, alignItems: "flex-end" },
  rotulo: { width: 170, fontSize: 9.5, color: CINZA },
  valor: { flex: 1, fontSize: 10.5 },
  valorForte: { flex: 1, fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  preencher: { flex: 1, borderBottomWidth: 0.8, borderBottomColor: TINTA, borderStyle: "dotted", height: 12, marginRight: 60 },
  quitacao: { marginTop: 26, fontSize: 10.5, lineHeight: 1.6, textAlign: "justify" },
  local: { marginTop: 22, fontSize: 10.5 },
  localLinha: { flexDirection: "row", alignItems: "flex-end", marginTop: 22 },
  localBranco: { borderBottomWidth: 0.8, borderBottomColor: TINTA, height: 12 },
  assinatura: { marginTop: 64, alignItems: "center" },
  assinaturaLinha: { width: 280, borderTopWidth: 0.9, borderTopColor: TINTA, paddingTop: 6, alignItems: "center" },
  assinaturaNome: { fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  assinaturaPapel: { fontSize: 8.5, color: CINZA, marginTop: 2 },
  rodape: { position: "absolute", bottom: 26, left: 52, right: 52, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: CLARO }
});

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string | null; forte?: boolean }) {
  return (
    <View style={s.linha} wrap={false}>
      <Text style={s.rotulo}>{rotulo}</Text>
      {valor ? <Text style={forte ? s.valorForte : s.valor}>{valor}</Text> : <View style={s.preencher} />}
    </View>
  );
}

function ReciboComissaoDocument({ m }: { m: ModeloRecibo }) {
  return (
    <Document title={`Recibo de comissão - ${m.vendedor}`} author={m.geradoPor} creator="Vibe">
      <Page size="A4" style={s.page}>
        <View style={s.topo}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do react-pdf não tem alt */}
          {m.empresa.logo ? <Image src={m.empresa.logo} style={s.logo} /> : <Text style={s.emitenteNome}>{m.empresa.razaoSocial}</Text>}
          <View style={s.emitente}>
            <Text style={s.emitenteNome}>{m.empresa.razaoSocial}</Text>
            <Text style={s.emitenteInfo}>CNPJ {m.empresa.cnpj}</Text>
            {m.empresa.endereco.map((linha) => (
              <Text key={linha} style={s.emitenteInfo}>
                {linha}
              </Text>
            ))}
          </View>
        </View>
        <View style={s.regua} />
        <View style={s.reguaFina} />

        <Text style={s.titulo}>Recibo de pagamento de comissão</Text>
        <Text style={s.subtitulo}>Vendas do período de {m.periodo}</Text>

        <View style={s.destaque} wrap={false}>
          <View>
            <Text style={s.destaqueRotulo}>Valor da comissão</Text>
            <Text style={s.destaqueValor}>{m.comissao}</Text>
          </View>
          <View>
            <Text style={s.destaqueConta}>
              <Text style={s.destaqueContaForte}>{m.percentual}</Text> sobre {m.totalVendas}
            </Text>
            <Text style={s.destaqueConta}>vendas {m.base.toLowerCase()}</Text>
          </View>
        </View>

        <Text style={s.secao}>Dados do pagamento</Text>
        <Linha rotulo="Vendedor" valor={m.vendedor} forte />
        <Linha rotulo="Período" valor={m.periodo} />
        <Linha rotulo="Pedidos no período" valor={m.qtdPedidos} />
        <Linha rotulo={`Total das vendas (${m.base.toLowerCase()})`} valor={m.totalVendas} />
        <Linha rotulo="Percentual aplicado" valor={m.percentual} />
        <Linha rotulo="Valor da comissão" valor={m.comissao} forte />
        <Linha rotulo="Forma de pagamento" valor={m.forma} />
        <Linha rotulo="Data do pagamento" valor={m.dataPagamento} />

        <Text style={s.quitacao}>
          Recebi de <Text style={{ fontFamily: "Helvetica-Bold" }}>{m.empresa.razaoSocial}</Text>, CNPJ {m.empresa.cnpj}, a importância
          acima, referente à comissão sobre as vendas do período, dando plena e total quitação.
        </Text>

        {m.local.dataExtenso ? (
          <Text style={s.local}>
            {m.local.cidade}, {m.local.dataExtenso}.
          </Text>
        ) : (
          <View style={s.localLinha}>
            <Text style={{ fontSize: 10.5 }}>{`${m.local.cidade}, `}</Text>
            <View style={[s.localBranco, { width: 28 }]} />
            <Text style={{ fontSize: 10.5 }}>{" de "}</Text>
            <View style={[s.localBranco, { width: 110 }]} />
            <Text style={{ fontSize: 10.5 }}>{" de "}</Text>
            <View style={[s.localBranco, { width: 44 }]} />
            <Text style={{ fontSize: 10.5 }}>.</Text>
          </View>
        )}

        <View style={s.assinatura} wrap={false}>
          <View style={s.assinaturaLinha}>
            <Text style={s.assinaturaNome}>{m.vendedor}</Text>
            <Text style={s.assinaturaPapel}>Vendedor</Text>
          </View>
        </View>

        <View style={s.rodape} fixed>
          <Text>
            Gerado no Vibe em {m.geradoEm} por {m.geradoPor}
          </Text>
          <Text>Recibo de comissão</Text>
        </View>
      </Page>
    </Document>
  );
}

export function criarReciboComissaoElement(m: ModeloRecibo): ReactElement<DocumentProps> {
  return createElement(ReciboComissaoDocument, { m }) as unknown as ReactElement<DocumentProps>;
}
