import fs from "fs";

const path = "src/features/orcamentos/OrcamentoFormPage.tsx";
let content = fs.readFileSync(path, "utf-8");
content = content.replace(/\r\n/g, '\n');

const replaces = [
  {
    search: `const hasCobrancas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int).length > 0 : false;`,
    replace: `const cobrancasVinculadas = proposta?.id_int ? getCobrancasByProposta(proposta.id_int) : [];
  const hasCobrancas = cobrancasVinculadas.length > 0;
  const hasActiveCobranca = cobrancasVinculadas.some(c => c.status !== "CANCELADO" && c.status !== "CANCELADA" && c.status !== "EXTORNADO" && c.status !== "RECUSADO");`
  },
  {
    search: `              {activeFormTab === "produtos" && (
                <div className="space-y-6">
                  <FormSection
                    title="6. Produtos"`,
    replace: `              {activeFormTab === "produtos" && (
                <fieldset disabled={hasActiveCobranca} className="group space-y-6">
                  <FormSection
                    title="6. Produtos"`
  },
  {
    search: `                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </div>
      )}

      {activeFormTab === "fretes" && (`,
    replace: `                  ) : null}
                </div>
              </>
            )}
          </FormSection>
        </fieldset>
      )}

      {activeFormTab === "fretes" && (`
  },
  {
    search: `      {activeFormTab === "fretes" && (
        <div className="space-y-6">
          <FormSection 
            title="7. Fretes e Entrega"`,
    replace: `      {activeFormTab === "fretes" && (
        <fieldset disabled={hasActiveCobranca} className="group space-y-6">
          <FormSection 
            title="7. Fretes e Entrega"`
  },
  {
    search: `                  ) : null}
                </div>
              </>
            )}
          </FormSection>
                </div>
              )}

              {activeFormTab === "pagamentos" && (`,
    replace: `                  ) : null}
                </div>
              </>
            )}
          </FormSection>
                </fieldset>
              )}

              {activeFormTab === "pagamentos" && (`
  },
  {
    search: `              {activeFormTab === "pagamentos" && (
                <div className="space-y-6">
                  {form.id_int === "NOVO" || !proposta ? (`,
    replace: `              {activeFormTab === "pagamentos" && (
                <fieldset disabled={hasActiveCobranca} className="group space-y-6">
                  {form.id_int === "NOVO" || !proposta ? (`
  },
  {
    search: `              onRefreshProposta={onReload}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {shouldShowRest && (`,
    replace: `              onRefreshProposta={onReload}
                    />
                  )}
                </fieldset>
              )}
            </>
          )}
        </div>

        {shouldShowRest && (`
  },
  {
    search: `              <div className="mt-4">
                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">
                  <Field label="Tipo">`,
    replace: `              <fieldset disabled={hasActiveCobranca} className="group mt-4">
                <div className="grid gap-3 grid-cols-[75px_1fr] items-start">
                  <Field label="Tipo">`
  },
  {
    search: `                  </p>
                )}
              </div>
            </FormSection>

            <FormSection title="9. Envio da proposta"`,
    replace: `                  </p>
                )}
              </fieldset>
            </FormSection>

            <FormSection title="9. Envio da proposta"`
  }
];

let success = true;
for (let i = 0; i < replaces.length; i++) {
  const item = replaces[i];
  if (content.includes(item.search)) {
    content = content.replace(item.search, item.replace);
    console.log("Success replacing block " + i);
  } else {
    console.error("FAILED to find block " + i + ":\n" + item.search);
    success = false;
  }
}

// Regex for toast is safe
const regexToast = /showToast\(\{\n*\s*type: "success",\n*\s*title: mode === "edit" \? "Orçamento atualizado com sucesso\." : "Orçamento criado com sucesso\.",\n*\s*description: "Aguardando sua escolha\.\.\."\n*\s*\}\);/;
if (regexToast.test(content)) {
  content = content.replace(regexToast, `showToast({
          type: res.errorMessage ? "info" : "success",
          title: res.errorMessage ? "Salvamento Parcial" : (mode === "edit" ? "Orçamento atualizado com sucesso." : "Orçamento criado com sucesso."),
          description: res.errorMessage || "Aguardando sua escolha..."
        });`);
  console.log("Success replacing toast");
} else {
  console.error("FAILED to find toast block");
  success = false;
}

if (success) {
  fs.writeFileSync(path, content, "utf-8");
  console.log("All replacements succeeded. File written.");
} else {
  console.log("Some replacements failed. File NOT written.");
}
