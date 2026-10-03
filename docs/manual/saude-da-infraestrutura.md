# Saúde da infraestrutura

> **Última revisão:** 03/10/2026
> **Caminho no menu:** Dashboard → seção Saúde da infraestrutura (no fim da página)
> **Endereço:** `/dashboard`
> **Acesso:** somente administradores

## Para que serve

Mostra, em linguagem simples, se o banco de dados e os arquivos do sistema estão com folga ou perto do limite, antes que o Vibe fique lento ou pare. Cada cartão é uma medida (memória, disco, conexões, arquivos...) com um selo de cor: **Tudo certo**, **Atenção** ou **Agir agora**.

Também dá para perguntar ao Maestro ("como está o banco?", "quanto espaço ainda temos?"). Ele lê exatamente os mesmos números e os mesmos limites desta seção, no mesmo horário de leitura, e explica o que cada alerta significa.

## Quem acessa

- Só administradores (Administrador e Super Admin). Quem tem outro perfil não vê a seção.
- O Maestro também só responde a administradores. Para os demais ele diz que é informação restrita a administradores e não dá número nem explicação.
- Quem resolve cada alerta é o desenvolvedor do Vibe. O administrador acompanha, decide o que envolve custo (máquina maior, mais espaço) e avisa o desenvolvedor.

## Botões e ações da tela

A seção não tem botões: é só leitura. Para ver números novos, recarregue a página depois do horário que aparece no topo da seção.

| Nome na tela | Onde fica | O que mostra |
|---|---|---|
| **Saúde da infraestrutura** | Dashboard, fim da página | Os cartões de medida, cada um com valor, selo de cor, faixas de amarelo e vermelho e uma explicação curta. |
| **Onde estão os arquivos** | Abaixo dos cartões, à esquerda | As pastas que mais ocupam espaço, com as colunas **Pasta**, **Arquivos**, **Tamanho** e **Novos em 30 dias**. "(aberta)" ao lado do nome quer dizer que qualquer pessoa com o link abre o arquivo. |
| **Histórico de alterações por mês** | Abaixo dos cartões, à direita | Quanto espaço o registro de quem mudou o quê ocupou em cada mês. |

## Passo a passo

### Ver como está o banco

1. No menu lateral, abra **Dashboard**.
2. Role até o fim da página, até a seção **Saúde da infraestrutura**.
3. Leia o horário no texto de abertura ("Leitura das ..."). Os números só são relidos depois do segundo horário que aparece ali.
4. Olhe o selo de cada cartão. **Tudo certo** não pede nada. **Atenção** pede acompanhar. **Agir agora** pede avisar o desenvolvedor.
5. Para cada cartão que não está em **Tudo certo**, veja abaixo "O que fazer em cada alerta".

### Saber em quantos meses os arquivos enchem

1. Veja no cartão **Arquivos guardados** quanto já está usado dos 100 GB.
2. Veja no cartão **Arquivos novos em 30 dias** o ritmo do último mês.
3. Divida o espaço que sobra pelo ritmo: o resultado é quantos meses faltam, se nada mudar. O painel não faz essa conta; o Maestro faz ("em quantos meses os 100 GB acabam?") e também diz quais pastas mais crescem.

### Ver quais pastas de arquivos mais crescem

1. Na tabela **Onde estão os arquivos**, olhe a coluna **Novos em 30 dias**. A pasta com o maior valor é a que mais cresce.
2. Compare com a coluna **Tamanho** para saber se ela é grande por acumular há muito tempo ou por estar crescendo agora.

## O que fazer em cada alerta

Cada cartão traz embaixo do valor as faixas de cor ("Amarelo ... · vermelho ..."). Em todos os casos, ao avisar o desenvolvedor, informe o horário da leitura e qual cartão mudou de cor.

### Memória livre

Quanto da memória do servidor do banco ainda está sobrando. Com pouca memória, as telas ficam lentas.

- **Atenção ou Agir agora:** o servidor está apertado. Avise o desenvolvedor para ver o que está consumindo memória.
- Se o aperto for constante, a saída é uma máquina com mais memória na Supabase. Isso aumenta o custo e é decisão do dono.

### Memória de emergência em atividade

Mostra se o servidor está, agora, passando dados da memória para o disco e de volta, o que deixa as telas lentas. A cor depende dessa atividade, não de quanto da memória de emergência está ocupada. A ocupação aparece numa linha de apoio no cartão e não define a cor.

- **Tudo certo** com ocupação alta: não há o que fazer. É normal o servidor guardar ali coisas paradas.
- **Atenção ou Agir agora:** o servidor está trocando dados com o disco o tempo todo e as telas ficam lentas. Olhe o cartão **Memória livre**: se ele também está baixo, a causa é falta de memória e vale o mesmo caminho dele. Avise o desenvolvedor.

### Carga do processador

Quanto trabalho o processador está fazendo na média dos últimos 5 minutos. O número de núcleos é o máximo que ele aguenta sem fila.

- Um pico curto não pede nada.
- **Atenção ou Agir agora** por vários minutos: avise o desenvolvedor. Ajuda dizer se alguém estava rodando um relatório pesado ou uma correção em massa naquela hora.

### Disco do banco ocupado

Espaço usado no disco onde ficam os dados do banco. A Supabase aumenta o disco sozinha, mas cobra a mais.

- O sistema não para por causa deste cartão, mas o custo sobe. Em **Atenção** ou **Agir agora**, peça ao desenvolvedor para ver o que está crescendo. O histórico de alterações costuma ser o maior consumidor (veja o cartão **Histórico de alterações do mês**).

### Conexões abertas no banco

Quantos programas estão conectados ao banco agora. Se chegar ao máximo, novos acessos são recusados.

- **Atenção:** acompanhe.
- **Agir agora:** pode haver telas lentas ou erro ao entrar no sistema. Avise o desenvolvedor na hora: é ele quem encontra o programa que está segurando conexões.

### Telas atualizando ao vivo

Assinaturas de atualização automática (chat e pendências). O plano aguenta 500 ao mesmo tempo.

- O número cresce com o total de pessoas e de abas abertas. Fechar abas do Vibe que ninguém está usando pode ajudar a baixar.
- Perto de 500, avise o desenvolvedor.

### Arquivos guardados

Soma de artes, PDFs, instaladores e anexos deste sistema. Os 100 GB do plano valem para a conta toda.

- Em **Atenção** (amarelo), veja na tabela **Onde estão os arquivos** qual pasta mais ocupa e decida com o desenvolvedor o que limpar. A pasta dos instaladores do agente (agent-releases) guarda uma versão nova a cada atualização e costuma ser a maior.
- Apagar arquivos é feito pelo desenvolvedor, depois da sua decisão. O Maestro só mostra os números.
- Em **Agir agora**, a decisão é limpar ou contratar mais espaço, antes de chegar a 100 GB.

### Arquivos novos em 30 dias

Quanto os arquivos cresceram no último mês. É o ritmo que diz quando os 100 GB acabam.

- Ritmo alto não é problema sozinho: o que importa é quanto espaço ainda sobra. Pergunte ao Maestro em quantos meses os 100 GB acabam.
- Se o ritmo está em **Atenção** ou **Agir agora**, veja na coluna **Novos em 30 dias** da tabela quais pastas estão crescendo e avise o desenvolvedor.

### Histórico de alterações do mês

Registro de quem mudou o quê. Correções em massa fazem este número saltar de uma vez.

- Hoje esse registro não é apagado nunca: cada correção em massa aumenta o banco de forma permanente.
- Em **Atenção** ou **Agir agora**, pergunte ao desenvolvedor se houve correção em massa no mês. Antes de pedir uma nova, combine com ele.

### Leituras atendidas pela memória

Quanto das consultas o banco responde sem ir ao disco. Abaixo de 99% as telas começam a pesar.

- **Atenção ou Agir agora:** avise o desenvolvedor. Costuma andar junto com o cartão **Memória livre** baixo.

## Regras e bloqueios

- A leitura fica guardada por 10 minutos. Abrir a página antes disso mostra a mesma leitura, com o mesmo horário.
- Quando alguma parte da leitura falha, o painel tenta de novo em 1 minuto.
- Tráfego de saída e cota do plano não aparecem aqui.
- Os 100 GB de arquivos valem para a conta toda da Supabase e o cartão soma só os arquivos deste sistema. Se a conta tiver outros projetos, o espaço real pode acabar antes.
- A previsão de meses do Maestro supõe que o ritmo dos últimos 30 dias continua igual e não desconta o que foi apagado nesse período.

## O que não confundir

- **Memória livre** (quanto sobra de memória) e **Memória de emergência em atividade** (se o servidor está usando o disco no lugar da memória) são medidas diferentes. As duas ruins ao mesmo tempo é o caso mais sério.
- **Arquivos guardados** (pastas de artes, PDFs e instaladores, limite de 100 GB da conta) e **Disco do banco ocupado** (onde ficam os dados do banco) são espaços diferentes, com limites diferentes.
- O **Histórico de alterações** faz parte do banco, não dos 100 GB de arquivos.
- **Agir agora** (vermelho) não quer dizer que o sistema parou: quer dizer que é hora de agir antes que fique lento ou pare.
- **Sem leitura** não é problema do cartão: é uma medida que não pôde ser lida naquele momento.

## Erros comuns

| O que aparece | Por que acontece | O que fazer |
|---|---|---|
| Não foi possível ler memória, disco, processador, conexões e Realtime agora. | O servidor de medidas da Supabase não respondeu. Os cartões dessas medidas ficam em **Sem leitura**. | Espere 1 minuto e recarregue. Se continuar, avise o desenvolvedor. |
| Não foi possível ler o tamanho do banco, o histórico e os arquivos agora. | A consulta que soma o banco e os arquivos falhou. Os cartões de arquivos, histórico e leituras ficam em **Sem leitura**. | Espere 1 minuto e recarregue. Se continuar, avise o desenvolvedor. |
| A seção não aparece no Dashboard | O perfil não é de administrador. | Peça a um administrador. |

## Veja também

- Nenhuma outra página do manual trata deste assunto.

## Arquivos de origem

- `src/features/dashboard/sections/InfraSaudeSection.tsx`
- `src/features/dashboard/infra-saude.ts`
- `src/app/api/admin/infra-saude/route.ts`
- `src/features/maestro/core/agent/maestro-agent-infra.server.ts`
