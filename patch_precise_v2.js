import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");

// Helper function to safely replace
function replaceSafe(search, replacement, name) {
  if (content.includes(search)) {
    content = content.replace(search, replacement);
    console.log("Success: " + name);
  } else {
    console.error("FAILED to find: " + name);
  }
}

replaceSafe(
  "const hasCobrancas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int).length > 0 : false;",
  "const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];\n  const hasCobrancas = cobrancasVinculadas.length > 0;\n  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== 'CANCELADO' && c.status !== 'CANCELADA' && c.status !== 'EXTORNADO' && c.status !== 'RECUSADO');",
  "hasActiveCobranca"
);

const regexToast = /showToast\(\{\s*type: "success",\s*title: mode === "edit" \? "Orçamento atualizado com sucesso\." : "Orçamento criado com sucesso\.",\s*description: "Aguardando sua escolha\.\.\."\s*\}\);/;
if (regexToast.test(content)) {
  content = content.replace(regexToast, 'showToast({\n          type: res.errorMessage ? "info" : "success",\n          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),\n          description: res.errorMessage || "Aguardando sua escolha..."\n        });');
  console.log("Success: Toast");
} else {
  console.error("FAILED to find: Toast");
}

replaceSafe(
  '              {activeFormTab === "produtos" && (\n                <div className="space-y-6">\n                  <FormSection',
  '              {activeFormTab === "produtos" && (\n                <fieldset disabled={hasActiveCobranca} className="group space-y-6">\n                  <FormSection',
  "Produtos start"
);

replaceSafe(
  '                  ) : null}\n                </div>\n              </>\n            )}\n          </FormSection>\n        </div>\n      )}',
  '                  ) : null}\n                </div>\n              </>\n            )}\n          </FormSection>\n        </fieldset>\n      )}',
  "Produtos end"
);

replaceSafe(
  '      {activeFormTab === "fretes" && (\n        <div className="space-y-6">\n          <FormSection',
  '      {activeFormTab === "fretes" && (\n        <fieldset disabled={hasActiveCobranca} className="group space-y-6">\n          <FormSection',
  "Fretes start"
);

replaceSafe(
  '                  ) : null}\n                </div>\n              </>\n            )}\n          </FormSection>\n        </div>\n      )}\n\n      {activeFormTab === "pagamentos" && (',
  '                  ) : null}\n                </div>\n              </>\n            )}\n          </FormSection>\n        </fieldset>\n      )}\n\n      {activeFormTab === "pagamentos" && (',
  "Fretes end"
);

replaceSafe(
  '      {activeFormTab === "pagamentos" && (\n        <div className="space-y-6">\n          {form.id_int === "NOVO" || !proposta ? (',
  '      {activeFormTab === "pagamentos" && (\n        <fieldset disabled={hasActiveCobranca} className="group space-y-6">\n          {form.id_int === "NOVO" || !proposta ? (',
  "Pagamentos start"
);

replaceSafe(
  '              onRefreshProposta={onReload}\n            />\n          )}\n        </div>\n      )}',
  '              onRefreshProposta={onReload}\n            />\n          )}\n        </fieldset>\n      )}',
  "Pagamentos end"
);

replaceSafe(
  '              <div className="mt-4">\n                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">\n                  <Field label="Tipo">',
  '              <fieldset disabled={hasActiveCobranca} className="group mt-4">\n                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">\n                  <Field label="Tipo">',
  "Desconto start"
);

replaceSafe(
  '                  </p>\n                )}\n              </div>\n            </FormSection>',
  '                  </p>\n                )}\n              </fieldset>\n            </FormSection>',
  "Desconto end"
);

fs.writeFileSync(path, content, "utf-8");
console.log("Script executed.");
