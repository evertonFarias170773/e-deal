const fs = require('fs');

let changelog = fs.readFileSync('docs/CHANGELOG.md', 'utf8');

const novo = `## [2026-07-01] - Módulo Fiscal e Prevenção de Build

### Adicionado
- **Fila Faturamento (Módulo Fiscal)**: Consolidação da Fila de Faturamento operando exclusivamente com dados reais da tabela \`public.propostas\`, filtrando propostas autorizadas via flag \`libera_nf = true\`. Os mocks foram completamente removidos da fila.
- **Registro de Prevenção de Build**: Documentada a falha de build gerada por imports/exports inválidos em \`PedidosListPage.tsx\` (que quebrou a rota \`/pedidos\` e afetou Fiscal/Notas Fiscais). Instituída a regra de validação via \`npm run build\` para garantir a integridade de rotas antes de pushes.

### Modificado
- **Módulo Contas a Receber**: Renomeadas as labels de previsão financeira de "Próximos 30/90 dias" para "Até 30/90 dias" visando esclarecer o efeito de acumulação a partir da data atual.

## [2026-06-25] - Higienização e Proteção: Módulo Contas a Receber`;

changelog = changelog.replace('## [YYYY-MM-DD] - Higienização e Proteção: Módulo Contas a Receber', novo);
fs.writeFileSync('docs/CHANGELOG.md', changelog, 'utf8');

const modulos = `\n### [Módulo Fiscal / Notas Fiscais] - Fila de Faturamento Real
- Status: Parcialmente Implementado
- Ações: A Fila de Faturamento agora exibe exclusivamente propostas que possuem a flag \`libera_nf = true\`, sem mistura com mocks. A aba de Histórico NF-e/NFS-e ainda está em fase de modelagem e pode conter dados simulados ou estrutura pendente de integração total.
- Base afetada: Leitura de \`public.propostas\` utilizando a flag \`libera_nf\`.\n`;
fs.appendFileSync('docs/MODULOS-IMPLEMENTADOS.md', modulos, 'utf8');

const passos = `\n### PENDÊNCIA TÉCNICA: Módulo Fiscal / Notas Fiscais
**Módulo:** Notas Fiscais & Faturamento
**Descrição:**
- Definir o ciclo de vida da flag \`libera_nf\` (se ela deve voltar para \`false\` após a emissão concluída ou se um novo status cobrirá o encerramento).
- Criar controle fiscal mais robusto (caso haja emissão parcial ou cancelamentos).
- Adicionar identificador visual claro no histórico separando NF-e (Produto) e NFS-e (Serviço).
- Substituir o uso de \`user?.isSuperAdmin || user?.isAdmin\` por permissões granulares fiscais específicas.
- Avaliar a integração real do histórico fiscal assim que os endpoints ou tabelas de resposta da Sefaz/Prefeitura estiverem modelados.

### PENDÊNCIA TÉCNICA: Validação de Build (Prevenção)
**Módulo:** Global / Rotas Compartilhadas
**Descrição:** Após alterações em módulos compartilhados (Pedidos, Orçamentos, Fiscal, Financeiro), é obrigatória a execução de \`npm run build\` localmente antes de enviar para produção. O comando \`npx tsc --noEmit\` não substitui o build completo da Vercel/Next.js, visto que não detecta falhas de SSR e page rendering causadas por falha de exportação em subcomponentes.\n`;
fs.appendFileSync('docs/PROXIMOS-PASSOS.md', passos, 'utf8');

const decisoes = `\n## Liberação Explícita para Faturamento (Fiscal)
**Decisão:** Utilização da flag \`public.propostas.libera_nf = true\` como gatilho de liberação explícita e temporária para a fila de faturamento.
**Motivo:** Evita que o setor fiscal fature acidentalmente pedidos que ainda estão em negociação ou validação comercial/produção. Mantém a separação de responsabilidades (Comercial libera -> Fiscal fatura). Mocks não são mais utilizados na fila de faturamento para evitar inconsistências contábeis.

## Regra Preventiva de Build e Imports
**Decisão:** Obrigatório confirmar a existência de arquivos e exports reais antes de importar novos componentes/services, e executar \`npm run build\` após alterações críticas.
**Motivo:** Erros de importação em componentes centrais (ex: \`PedidosListPage.tsx\`) quebram rotas inteiras e módulos dependentes (como Fiscal e Notas Fiscais). Validações exclusivas de TypeScript (\`tsc\`) não garantem a integridade do empacotamento Next.js para produção.\n`;
fs.appendFileSync('docs/DECISOES-TECNICAS.md', decisoes, 'utf8');
