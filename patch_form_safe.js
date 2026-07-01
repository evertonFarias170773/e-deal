import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// 1. Add hasActiveCobranca
const hasCobOld = `const hasCobrancas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int).length > 0 : false;`;
const newCobLogic = `const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];
  const hasCobrancas = cobrancasVinculadas.length > 0;
  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== "CANCELADO" && c.status !== "CANCELADA" && c.status !== "EXTORNADO" && c.status !== "RECUSADO");`;

if (content.includes(hasCobOld)) {
  content = content.replace(hasCobOld, newCobLogic);
  console.log("hasActiveCobranca inserido");
} else {
  console.log("hasCobrancas antigo não encontrado");
}

// 2. Fix the Toast using regex
const regexToast = /showToast\(\{\s*type: "success",\s*title: mode === "edit" \? "Orçamento atualizado com sucesso\." : "Orçamento criado com sucesso\.",\s*description: "Aguardando sua escolha\.\.\."\s*\}\);/;

const newToastLines = `showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || "Aguardando sua escolha..."
        });`;

if (regexToast.test(content)) {
  content = content.replace(regexToast, newToastLines);
  console.log("Toast success atualizado");
} else {
  console.log("Toast success antigo não encontrado!");
}

// 3. Disable sections with string splits
// Forma de Pagamento
const formaPagamentoTag = `<FormSection title="4. Forma de Pagamento" description="Como o cliente vai pagar.">`;
if (content.includes(formaPagamentoTag)) {
  content = content.replace(
    formaPagamentoTag,
    `<fieldset disabled={hasActiveCobranca} className="group">\n                    ${formaPagamentoTag}`
  );
}
const descontoGeralTag = `<FormSection title="5. Desconto Geral" description="Desconto aplicado ao final.">`;
if (content.includes(descontoGeralTag)) {
  const pieces = content.split(descontoGeralTag);
  if (pieces.length === 2) {
    pieces[0] = pieces[0].substring(0, pieces[0].lastIndexOf("</FormSection>")) + "</FormSection>\n                  </fieldset>\n\n                {/* Desconto Geral */}\n                ";
    content = pieces.join(`<fieldset disabled={hasActiveCobranca} className="group">\n                  ${descontoGeralTag}`);
  }
}
const produtosTab = `{activeFormTab === "produtos" && (`;
if (content.includes(produtosTab)) {
  const pieces = content.split(produtosTab);
  pieces[0] = pieces[0].substring(0, pieces[0].lastIndexOf("</FormSection>")) + "</FormSection>\n                  </fieldset>\n";
  content = pieces.join(produtosTab);
}
const formProdutosTag = `<FormSection
                    title="6. Produtos"
            description={form.isAvulso ? "Configure o valor total dos produtos no modo avulso." : "Escolha do catálogo e configure quantidades, descontos e variações."}
          >`;
if (content.includes(formProdutosTag)) {
  content = content.replace(formProdutosTag, `<fieldset disabled={hasActiveCobranca} className="group">\n                  ${formProdutosTag}`);
}
const fretesTab = `{activeFormTab === "fretes" && (`;
if (content.includes(fretesTab)) {
  const pieces = content.split(fretesTab);
  pieces[0] = pieces[0].substring(0, pieces[0].lastIndexOf("</FormSection>")) + "</FormSection>\n                  </fieldset>\n";
  content = pieces.join(fretesTab);
}
const formFretesTag = `<FormSection 
            title="7. Fretes e Entrega" 
            description={form.isAvulso ? "Configure o frete manual para a proposta avulsa." : "Integração em tempo real com cotações de SEDEX e cadastro de frete manual."}
          >`;
if (content.includes(formFretesTag)) {
  content = content.replace(formFretesTag, `<fieldset disabled={hasActiveCobranca} className="group">\n                  ${formFretesTag}`);
}
const pedidosTab = `{activeFormTab === "pedido" && (`;
if (content.includes(pedidosTab)) {
  const pieces = content.split(pedidosTab);
  pieces[0] = pieces[0].substring(0, pieces[0].lastIndexOf("</FormSection>")) + "</FormSection>\n                  </fieldset>\n";
  content = pieces.join(pedidosTab);
}

fs.writeFileSync(path, content, "utf-8");
console.log("OrcamentoFormPage.tsx atualizado de forma precisa e segura!");
