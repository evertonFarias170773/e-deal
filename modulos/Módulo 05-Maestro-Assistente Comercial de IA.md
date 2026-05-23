# Módulo 05 — Maestro / Assistente Comercial de IA

## Objetivo

O Maestro é um agente de IA comercial criado para ajudar vendedores a montar orçamentos, propostas informais e propostas formais com mais velocidade, clareza e qualidade.

Ele deve entender o pedido do vendedor em linguagem natural, identificar os produtos mencionados, buscar dados reais no Supabase, calcular valores, sugerir opções, comparar produtos, consultar frete quando necessário e formatar uma resposta pronta para o vendedor copiar e enviar ao cliente.

O Maestro não substitui o vendedor.  
Ele funciona como um copiloto comercial.

---

## Conceito do módulo

O Maestro deve atuar como um assistente inteligente dentro do fluxo comercial.

Ele pode ajudar em:

- interpretação do pedido do cliente;
- identificação de produtos;
- busca de dados técnicos dos produtos;
- cálculo de orçamento;
- montagem de proposta informal;
- transformação em proposta formal;
- comparação entre produtos;
- sugestão do melhor produto;
- explicação técnica;
- descrição de itens de segurança;
- consulta de fotos;
- consulta de frete;
- criação de briefing para arte;
- criação de prompt para arte-finalista;
- registro da conversa;
- apoio ao vendedor durante negociação.

---

## Essência do Maestro

O Maestro é um dos módulos mais importantes do sistema.

Ele foi a primeira solução de IA criada para o cliente e foi o diferencial que abriu caminho para a construção do ERP completo.

Por isso, no novo sistema, o Maestro não deve ser tratado como um chat genérico.  
Ele deve ser tratado como um copiloto comercial especializado no negócio da gráfica.

A principal qualidade do Maestro atual é:

- entender pedidos curtos e informais do vendedor;
- identificar cliente pelo ID;
- buscar dados reais no Supabase;
- reconhecer produtos por apelidos ou nomes comerciais;
- calcular orçamento;
- buscar opções de frete;
- montar uma resposta pronta para envio ao cliente;
- manter linguagem comercial, clara e humanizada.

O novo Maestro deve preservar essa essência e evoluir em precisão, velocidade, memória, integração e experiência visual.

---

## Exemplo de comportamento esperado

Entrada do vendedor:

```text
me manda um orçamento para o cliente 8469 para 4650 triband

Interpretação esperada:

cliente = 8469
produto = Pulseira Triband
quantidade = 4650
intenção = gerar orçamento informal

Ações internas esperadas:

Buscar o cliente 8469 no Supabase.
Confirmar nome do cliente.
Buscar produto relacionado a triband.
Buscar preço, prazo, formato e dados técnicos.
Calcular subtotal.
Buscar endereço principal do cliente.
Buscar opções de frete.
Definir frete padrão.
Montar proposta informal pronta para copiar.
Salvar a conversa na tabela dialogo.
Padrão de resposta comercial do Maestro

O Maestro deve responder sempre de forma precisa, estruturada e pronta para uso.

A resposta ideal deve conter:

número da proposta ou referência, quando houver;
nome do cliente;
título curto;
produto;
formato;
quantidade;
valor;
prazo de produção;
endereço/localidade resumida;
opções de frete;
subtotal dos produtos;
frete padrão;
total final;
emojis moderados para facilitar leitura;
separadores visuais simples.

Exemplo de estrutura:

N° prop. 16790 | LISITON DOCUMENTOS SEGUROS LTDA

📄 Orçamento conforme solicitação

🎟️ Pulseira Triband (25×2cm)
📦 Quantidade: 4650 unidades — R$ 784,00
🏭 Prazo de produção: 1 dia útil

-----------------------------
📌 Centro | Santa Cruz do Sul / RS
-----------------------------

🚚 Sedex: R$ 31,72
Prazo de entrega: 1 dia útil (+ prazo de produção)

🚚 Expresso São Miguel: R$ 53,00
Prazo de entrega sob consulta.

🚚 Unesul: R$ 40,00
Prazo de entrega sob consulta.

🧾 Subtotal produtos: R$ 784,00
Frete padrão (Sedex): R$ 31,72

💰 Total final: R$ 815,72
Regras de precisão

O Maestro precisa ser preciso porque o vendedor usa a resposta diretamente com o cliente.

Regras obrigatórias:

Nunca inventar cliente.
Nunca inventar produto.
Nunca inventar preço.
Nunca inventar prazo.
Nunca inventar frete.
Sempre buscar dados no Supabase quando forem dados comerciais reais.
Se encontrar mais de um produto possível, perguntar ou sugerir o mais provável.
Se faltar quantidade, perguntar.
Se faltar cliente, perguntar.
Se faltar endereço para frete, informar que precisa confirmar o endereço.
Se o cálculo não puder ser feito com segurança, não apresentar total final como definitivo.
Reconhecimento inteligente de pedidos

O Maestro deve entender frases curtas como:

cliente 8469 4650 triband
faz orçamento 2000 tyvek pro cliente 1200
manda preço de 500 credenciais pvc
quanto fica 10 mil ingressos segurança

E transformar em estrutura:

{
  "cliente_id": 8469,
  "produto_detectado": "triband",
  "quantidade": 4650,
  "intencao": "orcamento_informal"
}
Confirmação contextual

Quando o Maestro identificar o cliente, pode confirmar de forma natural:

Os dados do cliente LISITON DOCUMENTOS SEGUROS LTDA foram localizados. Deseja continuar com o orçamento para 4650 Pulseiras Triband?

Mas, quando a confiança for alta e o fluxo permitir, pode avançar direto para o orçamento.

Evolução esperada no novo Maestro

O novo Maestro deve ser melhor que o atual em:

interface;
histórico;
velocidade;
organização do contexto;
visualização de produtos;
cards de orçamento;
botão para copiar proposta;
botão para criar proposta formal;
comparação entre produtos;
geração de briefing para arte;
consulta de fotos;
integração com frete;
transparência sobre dados usados;
controle de permissões;
registro estruturado da conversa.

O vendedor deve conseguir ver não apenas a resposta final, mas também os dados usados para gerar o orçamento.

Interface ideal para o novo Maestro

Além do chat, a tela deve ter uma área de apoio com:

cliente identificado;
produto identificado;
quantidade;
subtotal;
opções de frete;
total final;
botão “Copiar orçamento”;
botão “Criar proposta formal”;
botão “Gerar briefing de arte”;
fotos do produto, quando disponíveis;
alertas de dados faltantes.

No desktop, esse contexto pode aparecer em painel lateral.

No mobile, pode aparecer em drawer ou painel inferior.

Regra final do Maestro

O Maestro deve parecer um vendedor sênior ajudando outro vendedor.

Ele deve ser rápido, prático, comercial e preciso.

A resposta precisa estar pronta para uso, mas sempre baseada em dados reais do Supabase.

---

## Situação atual

Atualmente o Maestro existe como um agente de IA dentro do FlutterFlow.

No novo sistema, a intenção é criar um Maestro externo, mais robusto, controlado e integrado diretamente ao Supabase.

A ideia é evoluir de um agente preso ao FlutterFlow para um módulo próprio de IA comercial, com histórico, contexto, ferramentas e integrações mais organizadas.

---

## Tabela de conversas

Tabela principal atual:

`public.dialogo`

Essa tabela serve para salvar conversas do agente.

Colunas conhecidas:

- `id`
- `created_at`
- `idConversa`
- `conversas`
- `NomeUser`
- `Logradouro`
- `Vendedor`
- `dataINI`
- `dataFIM`
- `ultimoPost`
- `id_vendedor`
- `user_id`

---

## Interpretação da tabela `dialogo`

### `id`

Identificador interno da conversa.

---

### `created_at`

Data de criação do registro.

---

### `idConversa`

Identificador textual da conversa.

Pode ser usado para agrupar mensagens de uma mesma sessão.

---

### `conversas`

Tipo: `jsonb`

Campo principal para armazenar o histórico da conversa.

Deve guardar mensagens, contexto, intenções, produtos identificados, respostas geradas e ações sugeridas.

---

### `NomeUser`

Nome do usuário ou cliente relacionado à conversa.

Uso provável:
- identificar quem está conversando;
- exibir histórico;
- personalizar resposta.

---

### `Logradouro`

Endereço ou referência de localidade.

Uso provável:
- apoio em cálculo de frete;
- contexto de entrega;
- endereço do cliente.

---

### `Vendedor`

Nome do vendedor responsável.

Uso:
- histórico;
- filtros;
- identificação do atendimento.

---

### `dataINI`

Data/hora de início da conversa.

---

### `dataFIM`

Data/hora de encerramento da conversa.

---

### `ultimoPost`

Data/hora da última mensagem.

Uso:
- ordenar conversas;
- identificar conversas ativas;
- histórico recente.

---

### `id_vendedor`

Identificador do vendedor relacionado.

Uso:
- vincular conversa ao usuário/vendedor;
- filtrar histórico por vendedor;
- alimentar relatórios comerciais.

---

### `user_id`

Identificador do usuário autenticado.

Deve se relacionar com Supabase Auth / `public.usuarios.user_id`.

Uso:
- saber quem operou o Maestro;
- permissões;
- histórico por usuário.

---

## Fontes de dados que o Maestro deve consultar

O Maestro deve usar o Supabase como fonte oficial da verdade.

Tabelas e views prováveis:

- `produtos`
- `produto_variacoes`
- `produtos_proposta`
- `clientes`
- `enderecos`
- `contatos`
- `cotacao_frete`
- `propostas`
- `pagamentos_v2`
- `empresas`
- `fotosProdutos`
- `base_conhecimento_produtos`
- `view_base_conhecimento_produtos`, se estiver em uso
- views/RPCs de cálculo de proposta, quando existirem

O Maestro não deve inventar preço, prazo, peso, descrição ou regra comercial se esses dados existirem no Supabase.

---

## Principais capacidades

### 1. Entender o pedido do vendedor

O Maestro deve interpretar frases como:

> Cliente quer 5 mil pulseiras para evento em Porto Alegre.

E extrair informações como:

- produto provável;
- quantidade;
- cliente;
- cidade;
- prazo;
- necessidade de frete;
- personalização;
- dúvidas pendentes.

---

### 2. Identificar produtos

O Maestro deve reconhecer produtos mesmo quando o vendedor usar:

- nome oficial;
- apelido;
- abreviação;
- erro de digitação;
- nome popular;
- descrição informal.

Exemplo:

- “pulseira tyvek”
- “pulseirinha”
- “triband”
- “credencial”
- “ingresso segurança”
- “crachá pvc”

O reconhecimento deve consultar dados reais do Supabase.

---

### 3. Buscar dados técnicos do produto

Para cada produto identificado, o Maestro deve buscar:

- nome oficial;
- formato;
- valor unitário;
- valor fixo;
- prazo;
- peso;
- descrição;
- nível de segurança;
- personalização;
- categoria;
- apelidos;
- fotos;
- variações;
- diferenciais;
- usos ideais.

---

### 4. Calcular orçamento

O Maestro deve calcular orçamento usando regras oficiais.

Pode considerar:

- produto;
- quantidade;
- valor unitário;
- valor fixo;
- variações;
- acabamentos;
- adicionais;
- frete;
- descontos;
- prazo;
- empresa;
- condição de pagamento.

Regra importante:

O Maestro não deve calcular “no chute” quando existir RPC, view ou regra no Supabase.

Quando faltar informação obrigatória, ele deve perguntar de forma objetiva.

---

### 5. Montar proposta informal

O Maestro deve gerar uma resposta pronta para o vendedor copiar e enviar ao cliente.

A proposta informal deve ser clara, comercial e humanizada.

Exemplo de estrutura:

- saudação curta;
- produto;
- quantidade;
- descrição resumida;
- diferenciais;
- valor;
- prazo;
- frete, se houver;
- condição de pagamento;
- chamada para fechamento.

A linguagem deve ser profissional, leve e consultiva.

---

### 6. Transformar orçamento em proposta formal

Quando o vendedor aprovar, o Maestro pode transformar o orçamento em proposta formal.

Isso deve envolver:

- confirmar cliente;
- confirmar produto;
- confirmar quantidade;
- confirmar valores;
- confirmar frete;
- confirmar vendedor;
- criar registro formal via RPC ou fluxo seguro;
- retornar ID da proposta.

O Maestro não deve inserir diretamente em várias tabelas críticas se existir RPC segura para criação de proposta.

---

### 7. Comparar produtos

O Maestro deve conseguir comparar produtos parecidos.

Exemplo:

- Pulseira Tyvek vs Pulseira Vinil
- Credencial PVC vs Credencial Papel
- Ingresso comum vs Ingresso de segurança
- Pulseira Triband vs Pulseira Couchê

A comparação deve mostrar:

- diferença de material;
- resistência;
- segurança;
- custo;
- prazo;
- uso ideal;
- melhor escolha para cada caso.

---

### 8. Indicar o melhor produto

O Maestro pode sugerir o produto mais adequado com base no contexto.

Exemplo:

> Para evento de um dia, com controle simples e baixo custo, a melhor opção é pulseira Tyvek.

Critérios possíveis:

- tipo de evento;
- duração;
- público;
- necessidade de segurança;
- orçamento;
- prazo;
- personalização;
- resistência;
- controle de acesso.

A sugestão deve explicar o motivo.

---

### 9. Mostrar fotos

O Maestro deve conseguir retornar ou indicar fotos dos produtos.

Fonte provável:

`fotosProdutos`

Campos conhecidos:

- `nomeProduto`
- `imagensURL`
- `idProduto`

Uso:

- mostrar referência visual;
- ajudar vendedor a explicar ao cliente;
- comparar modelos.

---

### 10. Descrever segurança do produto

O Maestro deve explicar itens de segurança de forma comercial e técnica.

Exemplos de segurança:

- numeração;
- código de barras;
- QR Code;
- serrilha;
- lacre;
- material resistente;
- personalização;
- dados variáveis;
- controle visual;
- dificuldade de falsificação.

A explicação deve ser adaptada ao produto.

---

### 11. Criar briefing para arte

O Maestro deve ajudar o vendedor a criar um briefing claro para o art-finalista.

O briefing deve conter:

- produto;
- formato;
- quantidade;
- tema;
- cores;
- textos obrigatórios;
- logos;
- dados variáveis;
- numeração;
- QR Code ou código de barras;
- referências visuais;
- observações do cliente;
- restrições técnicas.

---

### 12. Criar prompt para arte-finalista ou IA de layout

O Maestro também pode gerar um prompt para criação de layout.

Esse prompt deve ser objetivo e técnico.

Exemplo de estrutura:

- tipo de produto;
- estilo visual;
- cores;
- elementos principais;
- textos;
- hierarquia;
- restrições de impressão;
- formato;
- orientação;
- informações de segurança.

O Maestro não deve prometer que a arte final está pronta se apenas gerou um briefing ou prompt.

---

## Fluxo principal do Maestro

1. Vendedor escreve o pedido.
2. Maestro interpreta a intenção.
3. Maestro identifica produtos, quantidades e contexto.
4. Maestro busca dados no Supabase.
5. Maestro verifica se faltam informações.
6. Se faltar algo, pergunta objetivamente.
7. Se houver dados suficientes, calcula ou monta orçamento.
8. Maestro formata resposta informal.
9. Vendedor revisa.
10. Se necessário, Maestro ajusta.
11. Se aprovado, pode gerar proposta formal por fluxo seguro.
12. Conversa é salva em `dialogo`.

---

## Tipos de resposta do Maestro

### Resposta consultiva

Usada para explicar produto ou orientar vendedor.

### Orçamento informal

Usado para enviar ao cliente por WhatsApp ou e-mail.

### Comparação

Usada para explicar diferenças entre produtos.

### Resumo técnico

Usado para detalhar material, segurança ou acabamento.

### Briefing de arte

Usado para orientar art-finalista.

### Ação estruturada

Usada quando for criar proposta formal, consultar frete ou buscar produto.

---

## Padrão da proposta informal

A proposta informal deve ser fácil de copiar.

Estrutura sugerida:

```text
Olá! Segue uma opção para o seu pedido:

Produto:
[Nome do produto]

Quantidade:
[Quantidade]

Descrição:
[Resumo comercial do produto]

Diferenciais:
[Segurança, personalização, uso ideal]

Valor:
R$ [valor]

Prazo:
[prazo]

Frete:
[opção de frete, se houver]

Condição:
[condição de pagamento]

Se quiser, já posso seguir com a proposta formal.

Padrão de comparação de produtos

Estrutura sugerida:

Comparativo rápido:

Produto A:
- Melhor para:
- Vantagens:
- Limitações:
- Custo:

Produto B:
- Melhor para:
- Vantagens:
- Limitações:
- Custo:

Minha sugestão:
[recomendação baseada no caso]
Padrão de briefing de arte

Estrutura sugerida:

Briefing para arte:

Produto:
Formato:
Tema:
Cores:
Textos obrigatórios:
Logo:
Dados variáveis:
Itens de segurança:
Referências:
Observações:
Objetivo visual:
Registro da conversa

Toda conversa deve ser salva.

A tabela atual é:

public.dialogo

O registro deve permitir:

recuperar histórico;
continuar conversa;
auditar atendimento;
entender o que foi prometido;
consultar pedidos anteriores;
analisar uso do Maestro.
Regras de segurança
O Maestro não deve inventar dados de produto.
O Maestro não deve alterar tabelas críticas sem função segura.
O Maestro não deve criar proposta formal sem confirmação do vendedor.
O Maestro não deve confirmar pagamento.
O Maestro não deve emitir nota fiscal.
O Maestro não deve prometer prazo ou preço sem base no Supabase.
O Maestro deve registrar o contexto da conversa.
O Maestro deve deixar claro quando algo é sugestão.
O Maestro deve pedir informação quando houver ambiguidade importante.
O Maestro deve respeitar permissões do usuário logado.
Integrações necessárias
Supabase

Usado para:

buscar produtos;
buscar clientes;
buscar fotos;
buscar preços;
salvar conversa;
criar proposta formal, se houver RPC;
consultar frete, se houver integração registrada.
Frete

O Maestro deve poder buscar opção de frete quando houver:

cliente;
endereço;
CEP;
peso;
quantidade;
produto.

Se faltar CEP ou endereço, deve pedir.

Propostas

Quando o vendedor decidir transformar orçamento em proposta formal, o Maestro deve acionar fluxo seguro.

Preferir RPC ou Edge Function.

Não fazer vários inserts diretos sem validação.

Ferramentas internas esperadas

O Maestro externo pode ter ferramentas como:

buscarProduto
buscarProdutoPorApelido
buscarFotosProduto
calcularOrcamento
consultarFrete
buscarCliente
buscarEnderecoCliente
salvarDialogo
atualizarDialogo
criarPropostaFormal
gerarBriefingArte
gerarPromptArte
compararProdutos

Essas ferramentas devem ser implementadas de forma segura no backend.

Páginas do módulo
Tela do Maestro

Objetivo:

Permitir conversa entre vendedor e agente.

Elementos:

histórico da conversa;
campo de mensagem;
sugestões rápidas;
cards de produtos encontrados;
resumo de orçamento;
botão para copiar proposta;
botão para gerar proposta formal;
botão para gerar briefing de arte.
Histórico de conversas

Objetivo:

Listar conversas anteriores.

Filtros:

vendedor;
cliente;
data;
produto;
status;
idConversa.

Ações:

abrir conversa;
continuar conversa;
copiar proposta;
transformar em proposta formal;
arquivar.
Detalhe da conversa

Objetivo:

Ver todo o histórico salvo.

Seções:

mensagens;
produtos mencionados;
orçamento gerado;
proposta formal, se criada;
briefing de arte;
dados do cliente;
vendedor responsável.
Componentes necessários
MaestroChatPage
MaestroChatInput
MaestroMessageList
MaestroMessageBubble
MaestroProductCard
MaestroQuoteCard
MaestroFreightOptions
MaestroActionPanel
MaestroConversationHistory
MaestroCopyProposalButton
MaestroCreateProposalButton
MaestroArtBriefingCard
MaestroPromptArteCard
Padrão visual

O Maestro deve ter aparência de copiloto comercial.

Sugestão:

chat limpo;
área lateral com contexto;
cards para produtos encontrados;
orçamento em card destacado;
botão “Copiar para cliente”;
botão “Criar proposta formal”;
mensagens de IA com visual diferente das mensagens do vendedor;
alertas quando faltar informação;
indicadores de dados vindos do Supabase.
Comportamento desktop

No desktop:

chat no centro;
painel lateral direito com contexto do orçamento;
produtos encontrados em cards;
proposta informal em bloco copiável;
histórico acessível.

Layout sugerido:

coluna esquerda: histórico/conversas;
coluna central: chat;
coluna direita: orçamento/contexto/produtos.
Comportamento mobile

No mobile:

chat em tela cheia;
contexto/orçamento em drawer ou aba inferior;
botão fixo para copiar proposta;
produtos em cards verticais;
ações em menu.

Não depender de hover.

Ações principais
Enviar mensagem
Copiar proposta informal
Gerar proposta formal
Gerar briefing de arte
Gerar prompt para arte
Consultar frete
Ver fotos do produto
Comparar produtos
Salvar conversa
Continuar conversa
Ações críticas

Ações que exigem confirmação:

criar proposta formal;
alterar proposta existente;
vincular conversa a cliente;
usar preço diferente do Supabase;
aplicar desconto;
enviar dados para fluxo externo.

O Maestro pode sugerir, mas o vendedor confirma.

O que este módulo faz

Este módulo:

ajuda vendedores;
interpreta pedidos;
consulta produtos;
calcula orçamento;
monta proposta informal;
sugere produto;
compara opções;
gera briefing de arte;
salva conversas;
pode iniciar proposta formal com confirmação.
O que este módulo não faz

Este módulo não deve:

substituir aprovação comercial;
alterar financeiro sozinho;
emitir NF-e;
emitir NFS-e;
confirmar pagamento;
cancelar proposta;
inventar produto/preço/prazo;
criar proposta formal sem confirmação.
Primeira implementação sugerida

Etapa 1:

criar tela de chat do Maestro;
salvar conversas em dialogo;
permitir histórico por usuário/vendedor;
responder usando contexto básico.

Etapa 2:

conectar busca de produtos no Supabase;
reconhecer produtos por nome e apelido;
retornar cards de produtos.

Etapa 3:

montar orçamento informal simples;
calcular valores com base no Supabase;
botão copiar proposta.

Etapa 4:

consultar frete;
adicionar fotos;
comparar produtos.

Etapa 5:

transformar orçamento aprovado em proposta formal via função segura.

Etapa 6:

gerar briefing e prompt para arte-finalista.
Resultado esperado

Ao final deste módulo, o vendedor deve conseguir:

conversar com o Maestro;
informar um pedido em linguagem natural;
receber sugestão de produto;
ver dados técnicos;
ver fotos;
gerar orçamento informal;
copiar mensagem para cliente;
consultar frete;
gerar briefing de arte;
transformar em proposta formal quando necessário.
Regras para Cursor/Codex

Ao implementar este módulo:

não criar lógica de preço inventada;
não buscar produtos em dados mockados se Supabase estiver disponível;
não salvar conversa fora da tabela oficial sem autorização;
não criar proposta formal com inserts soltos sem confirmar fluxo;
não expor chaves sensíveis no front;
não usar service_role no navegador;
não prometer ação executada se ela apenas foi sugerida;
não ocultar quando faltar informação;
sempre preservar histórico da conversa.
Pendências para revisão do Everton
Confirmar se dialogo continuará sendo a tabela oficial de conversas.
Confirmar formato ideal do JSON em dialogo.conversas.
Confirmar se o Maestro externo será app próprio, Edge Function ou agente em outro backend.
Confirmar quais RPCs já existem para cálculo de proposta.
Confirmar como criar proposta formal com segurança.
Confirmar fonte oficial das fotos dos produtos.
Confirmar fonte oficial para apelidos de produtos.
Confirmar regra de frete dentro do Maestro.
Confirmar se o Maestro poderá aplicar desconto.
Confirmar se o Maestro poderá enviar mensagem direto ao cliente ou apenas gerar texto para copiar.