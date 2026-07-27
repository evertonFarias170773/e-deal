import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { OsPdfViewModel, OsPdfProduto, OsPdfModelo } from "../services/os-viewmodel.service";

/**
 * Documento PDF da OS (Boletim de Produção) — layout "OS 2027".
 *
 * Estrutura: faixa de cabeçalho (logo + Nº OS | Setor do boletim | Prazo/Hora | QR);
 * bloco de cliente/evento/vendedor/designer; um CARD por produto da proposta —
 * barra de título com quantidade e peso, seguida dos cards dos seus modelos
 * (imagem grande da arte + campos + checklist IMP/ACA/CON fixo); observações;
 * forma de envio; assinaturas; rodapé fixo com paginação.
 *
 * Regra de agrupamento: modelos nunca cruzam produtos — cada card de produto
 * renderiza somente `produto.modelos`.
 *
 * Paginação segura: a barra de produto e cada linha de 3 cards de modelo são
 * blocos wrap={false}; quebras só ocorrem entre blocos; rodapé fixo em todas as
 * páginas. Sem valores financeiros.
 */

const OBS_MAX_CHARS = 600;

/** Checklist fixo do card de modelo — literal do layout aprovado, nunca variável. */
const CHECKLIST_CARD = ["IMP", "ACA", "CON"];

/** Cards de modelo por linha (grade do layout 2027). */
const MODELOS_POR_LINHA = 3;


const nfInteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nfDecimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Remove caracteres fora do Latin-1 (emoji etc.) — fontes Standard do PDF são WinAnsi. */
function pdfSafe(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/ /g, " ")
    .replace(/[^ -ÿ]/g, "")
    .trim();
}

function truncar(value: string | null | undefined, max: number = OBS_MAX_CHARS): string {
  const text = pdfSafe(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... (integra no ERP - use o QR Code)`;
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

/** Data curta (dd/mm/aa) usada no selo de PRAZO do cabeçalho. */
function formatarDataCurta(iso: string | null | undefined): string {
  const completa = formatarData(iso);
  if (completa === "-") return "-";
  const partes = completa.split("/");
  return partes.length === 3 ? `${partes[0]}/${partes[1]}/${partes[2].slice(-2)}` : completa;
}

/** `hora` do boletim vem como TIME (HH:MM:SS) — exibimos HH:MM. */
function formatarHora(hora: string | null | undefined): string {
  const texto = pdfSafe(hora);
  const match = texto.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "-";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatarQuantidade(valor: number | null | undefined): string {
  return nfInteiro.format(Number(valor) || 0);
}

/** peso_total é gravado em gramas; acima de 1kg exibimos em kg. */
function formatarPeso(gramas: number | null | undefined): string | null {
  const valor = Number(gramas);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return valor >= 1000 ? `${nfDecimal.format(valor / 1000)} kg` : `${nfInteiro.format(valor)} g`;
}

function faixaNumeracao(modelo: OsPdfModelo): string {
  const inicio = modelo.numeracaoInicio;
  const fim = modelo.numeracaoFim;
  if (inicio === undefined && fim === undefined) return "-";
  return `${inicio !== undefined ? nfInteiro.format(inicio) : "?"}-${fim !== undefined ? nfInteiro.format(fim) : "?"}`;
}

function emGrupos<T>(itens: T[], tamanho: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    grupos.push(itens.slice(i, i + tamanho));
  }
  return grupos;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 46,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111",
    flexDirection: "column"
  },
  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 8,
    padding: 7,
    marginBottom: 7
  },
  headerIdentidade: { width: 128, alignItems: "flex-start" },
  logo: { width: 104, height: 30, objectFit: "contain", marginBottom: 5 },
  osBox: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center"
  },
  osBoxLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#5a6b7a", marginRight: 5 },
  osBoxNumero: { fontSize: 17, fontFamily: "Helvetica-Bold" },
  headerSetor: { flex: 1, paddingHorizontal: 10 },
  setorBox: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center"
  },
  setorLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#5a6b7a", marginRight: 8 },
  setorValor: { fontSize: 16, fontFamily: "Helvetica-Bold", flex: 1, textAlign: "center" },
  headerPrazo: { width: 116, marginRight: 8 },
  prazoBox: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4
  },
  prazoLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#5a6b7a" },
  prazoValor: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  qr: { width: 62, height: 62 },
  qrIndisponivel: {
    width: 62,
    height: 62,
    borderWidth: 0.5,
    borderColor: "#999",
    alignItems: "center",
    justifyContent: "center"
  },
  // ── Cliente / responsáveis ─────────────────────────────────────────────────
  bloco: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginBottom: 7
  },
  linha: { flexDirection: "row", flexWrap: "wrap" },
  campo: { flexDirection: "row", marginRight: 16, marginBottom: 1.5 },
  campoLabel: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  campoValor: { fontSize: 8.5 },
  // ── Card do produto ────────────────────────────────────────────────────────
  produtoCard: { marginBottom: 7 },
  produtoBarra: {
    backgroundColor: "#58585a",
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4
  },
  produtoNome: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textTransform: "uppercase",
    flex: 1,
    paddingRight: 8
  },
  produtoChip: {
    backgroundColor: "#ffffff",
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 5
  },
  produtoChipLabel: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#5a6b7a", marginRight: 4 },
  produtoChipValor: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  // ── Card do modelo ─────────────────────────────────────────────────────────
  modelosLinha: { flexDirection: "row", marginBottom: 4 },
  modeloCard: {
    flex: 1,
    borderWidth: 0.75,
    borderColor: "#b9c5d0",
    borderRadius: 4,
    padding: 4
  },
  modeloEspacador: { flex: 1 },
  modeloGap: { width: 5 },
  modeloImagem: { width: "100%", height: 58, objectFit: "contain", marginBottom: 4 },
  modeloImagemVazia: {
    width: "100%",
    height: 58,
    marginBottom: 4,
    borderWidth: 0.75,
    borderColor: "#d5dde4",
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center"
  },
  modeloImagemVaziaTexto: { fontSize: 6.5, color: "#9aa8b5", textAlign: "center" },
  modeloLinhaCampos: { flexDirection: "row", alignItems: "flex-start", marginBottom: 2 },
  modeloCampo: { flex: 1, paddingHorizontal: 2 },
  modeloCampoLabel: { fontSize: 5.5, fontFamily: "Helvetica-Bold", color: "#6b7a88" },
  modeloCampoValor: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right" },
  modeloDivisor: { width: 0.75, backgroundColor: "#cfd8e0", alignSelf: "stretch" },
  modeloObs: { fontSize: 6, color: "#5a6b7a", marginTop: 1, marginBottom: 1 },
  checklistLinha: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 0.75,
    borderTopColor: "#cfd8e0",
    marginTop: 3,
    paddingTop: 3
  },
  checklistItem: { flexDirection: "row", alignItems: "center", marginRight: 6 },
  checklistCaixa: {
    width: 8,
    height: 8,
    borderWidth: 0.75,
    borderColor: "#6b7a88",
    borderRadius: 1.5,
    marginRight: 2.5
  },
  checklistTexto: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#3f3f42" },
  checklistAssinatura: { flex: 1, borderBottomWidth: 0.75, borderBottomColor: "#cfd8e0", height: 8 },
  // ── Observações / envio ────────────────────────────────────────────────────
  obsBox: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginTop: 4,
    minHeight: 46
  },
  obsTitulo: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
    textTransform: "uppercase"
  },
  obsTexto: { fontSize: 8, marginBottom: 1 },
  envioBarra: {
    borderWidth: 1,
    borderColor: "#3f3f42",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginTop: 5,
    alignItems: "flex-end"
  },
  envioTexto: { fontSize: 9, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  // ── Assinaturas / rodapé ───────────────────────────────────────────────────
  assinaturaArea: { marginTop: "auto", paddingTop: 26, flexDirection: "row", justifyContent: "space-between" },
  assinatura: {
    width: 150,
    borderTopWidth: 0.9,
    borderTopColor: "#111",
    paddingTop: 3,
    alignItems: "center"
  },
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

function Campo({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <View style={styles.campo}>
      <Text style={styles.campoLabel}>{label}: </Text>
      <Text style={styles.campoValor}>{pdfSafe(valor) || "-"}</Text>
    </View>
  );
}

function CampoModelo({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={styles.modeloCampo}>
      <Text style={styles.modeloCampoLabel}>{label}</Text>
      <Text style={styles.modeloCampoValor}>{pdfSafe(valor) || "-"}</Text>
    </View>
  );
}

function LinhaCampos({ esquerda, direita }: { esquerda: React.ReactNode; direita: React.ReactNode }) {
  return (
    <View style={styles.modeloLinhaCampos}>
      {esquerda}
      <View style={styles.modeloDivisor} />
      {direita}
    </View>
  );
}

/** Card de um modelo: imagem grande da arte + campos + checklist fixo. */
function ModeloCard({ modelo }: { modelo: OsPdfModelo }) {
  return (
    <View style={styles.modeloCard}>
      {modelo.imagemDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image style={styles.modeloImagem} src={modelo.imagemDataUrl} />
      ) : (
        <View style={styles.modeloImagemVazia}>
          <Text style={styles.modeloImagemVaziaTexto}>Sem imagem{"\n"}da arte</Text>
        </View>
      )}

      <LinhaCampos
        esquerda={<CampoModelo label="SETOR:" valor={modelo.nomeModelo} />}
        direita={<CampoModelo label="QUANT.:" valor={formatarQuantidade(modelo.quantidade)} />}
      />
      <LinhaCampos
        esquerda={<CampoModelo label="COR:" valor={modelo.corMaterial || "-"} />}
        direita={<CampoModelo label="INICIAL/FINAL:" valor={faixaNumeracao(modelo)} />}
      />
      <LinhaCampos
        esquerda={<CampoModelo label="NUM.:" valor={modelo.gabarito || "-"} />}
        direita={<CampoModelo label="MODELO:" valor={modelo.codigo || "-"} />}
      />
      <LinhaCampos
        esquerda={<CampoModelo label="IMPRESSAO:" valor={modelo.frenteVerso ? "FxV" : "Frente"} />}
        direita={<CampoModelo label="NUMERACAO:" valor={modelo.tipoNumeracao || "-"} />}
      />

      {modelo.obsTecnicas ? (
        <Text style={styles.modeloObs}>Obs: {truncar(modelo.obsTecnicas, 90)}</Text>
      ) : null}

      <View style={styles.checklistLinha}>
        {CHECKLIST_CARD.map((etapa) => (
          <View key={etapa} style={styles.checklistItem}>
            <View style={styles.checklistCaixa} />
            <Text style={styles.checklistTexto}>{etapa}</Text>
          </View>
        ))}
        <View style={styles.checklistAssinatura} />
      </View>
    </View>
  );
}

/** Uma linha da grade de modelos (até 3 cards), com espaçadores de largura. */
function ModelosLinha({ modelos }: { modelos: OsPdfModelo[] }) {
  return (
    <View style={styles.modelosLinha} wrap={false}>
      {modelos.map((modelo, j) => (
        <React.Fragment key={j}>
          {j > 0 ? <View style={styles.modeloGap} /> : null}
          <ModeloCard modelo={modelo} />
        </React.Fragment>
      ))}
      {/* Espaçadores mantêm a largura dos cards na última linha incompleta. */}
      {Array.from({ length: MODELOS_POR_LINHA - modelos.length }).map((_, k) => (
        <React.Fragment key={`vazio-${k}`}>
          <View style={styles.modeloGap} />
          <View style={styles.modeloEspacador} />
        </React.Fragment>
      ))}
    </View>
  );
}

/** Card do produto: barra de título (qtd + peso) e a grade dos seus modelos. */
function ProdutoCard({ produto }: { produto: OsPdfProduto }) {
  const codigoNome = [produto.codigo, pdfSafe(produto.nome)]
    .filter((v) => v !== null && v !== "")
    .join(" - ");
  const peso = formatarPeso(produto.pesoTotalGramas);
  const linhas = emGrupos(produto.modelos, MODELOS_POR_LINHA);

  const barra = (
    <View style={styles.produtoBarra}>
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
  );

  return (
    <View style={styles.produtoCard}>
      {/* Barra + primeira linha de cards no mesmo bloco: a barra nunca fica órfã. */}
      <View wrap={false}>
        {barra}
        {linhas.length > 0 ? <ModelosLinha modelos={linhas[0]} /> : null}
      </View>
      {linhas.slice(1).map((linha, i) => (
        <ModelosLinha key={i} modelos={linha} />
      ))}
    </View>
  );
}

export interface OsPdfDocumentProps {
  vm: OsPdfViewModel;
  /** Data URL do QR Code (null = QR indisponível, ex.: APP_URL ausente em produção). */
  qrDataUrl: string | null;
  /** Data URL do logo da empresa (null = sem logo). */
  logoDataUrl: string | null;
}

export function OsPdfDocument({ vm, qrDataUrl, logoDataUrl }: OsPdfDocumentProps) {
  const emissao = formatarData(vm.os.emissao);
  // Setor é campo próprio do boletim (pedidos_artes.setor) — nunca o setor do produto.
  const setor = pdfSafe(vm.boletim.setor).toUpperCase() || "-";
  const obsLinhas = [vm.obs.obsCriticas, vm.obs.obsImpressao, vm.obs.obsAcabamento]
    .map((t) => truncar(t, 200))
    .filter(Boolean);
  const entregaFrete = vm.frete
    ? [vm.frete.servico, vm.frete.transportadora].filter(Boolean).join(" - ")
    : null;

  return (
    <Document
      title={`OS ${vm.idInt}`}
      author={vm.empresa.nome}
      subject="Boletim de Producao / Ordem de Servico"
    >
      <Page size="A4" style={styles.page}>
        {/* Cabeçalho — logo + Nº OS | Setor do boletim | Prazo/Hora | QR */}
        <View style={styles.header} wrap={false}>
          <View style={styles.headerIdentidade}>
            {logoDataUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.logo} src={logoDataUrl} />
            ) : null}
            <View style={styles.osBox}>
              <Text style={styles.osBoxLabel}>OS:</Text>
              <Text style={styles.osBoxNumero}>{vm.idInt}</Text>
            </View>
          </View>

          <View style={styles.headerSetor}>
            <View style={styles.setorBox}>
              <Text style={styles.setorLabel}>Setor:</Text>
              <Text style={styles.setorValor}>{setor}</Text>
            </View>
          </View>

          <View style={styles.headerPrazo}>
            <View style={styles.prazoBox}>
              <Text style={styles.prazoLabel}>PRAZO:</Text>
              <Text style={styles.prazoValor}>{formatarDataCurta(vm.os.prazo)}</Text>
            </View>
            <View style={styles.prazoBox}>
              <Text style={styles.prazoLabel}>HORA:</Text>
              <Text style={styles.prazoValor}>{formatarHora(vm.boletim.hora)}</Text>
            </View>
          </View>

          {qrDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image style={styles.qr} src={qrDataUrl} />
          ) : (
            <View style={styles.qrIndisponivel}>
              <Text style={{ fontSize: 6, color: "#999", textAlign: "center" }}>QR{"\n"}indisponivel</Text>
            </View>
          )}
        </View>

        {/* Cliente e responsáveis (dados da proposta) */}
        <View style={styles.bloco} wrap={false}>
          <View style={styles.linha}>
            <Campo label="CLIENTE" valor={vm.cliente.nome} />
            <Campo label="EVENTO" valor={vm.boletim.evento} />
          </View>
          <View style={styles.linha}>
            <Campo label="VENDEDOR" valor={vm.vendedor} />
            <Campo label="DESIGNER" valor={vm.designer} />
          </View>
        </View>

        {/* Um card por produto da proposta, cada um com os seus próprios modelos */}
        {vm.produtos.map((produto, i) => (
          <ProdutoCard key={i} produto={produto} />
        ))}

        {/* Observações da OS */}
        <View style={styles.obsBox} wrap={false}>
          <Text style={styles.obsTitulo}>Observações:</Text>
          {obsLinhas.length > 0 ? (
            obsLinhas.map((linha, i) => (
              <Text key={i} style={styles.obsTexto}>
                {linha}
              </Text>
            ))
          ) : (
            <Text style={styles.obsTexto}>-</Text>
          )}
        </View>

        {/* Forma de envio (mesma origem/comportamento do layout anterior) */}
        <View style={styles.envioBarra} wrap={false}>
          <Text style={styles.envioTexto}>Forma de envio: {pdfSafe(entregaFrete) || "-"}</Text>
        </View>

        {/* Assinaturas (base da última página) */}
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

        {/* Rodapé fixo em todas as páginas */}
        <View style={styles.footer} fixed>
          <Text>OS #{vm.idInt}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} de ${totalPages}`}
          />
          <Text>Emitido em {emissao}</Text>
        </View>
      </Page>
    </Document>
  );
}
