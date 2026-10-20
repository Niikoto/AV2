# Greencode

CLI em Node.js e TypeScript para o núcleo operacional de uma plataforma de logística reversa de resíduos e equipamentos eletrônicos.

O projeto permite provisionar o sistema, autenticar usuários, cadastrar organizações e lotes, registrar equipamentos, executar triagem, registrar movimentações, consultar rastreabilidade e gerar relatórios.

## Requisitos

- Node.js 22.12 ou superior dentro da linha 22, ou 24 ou superior
- npm

O requisito do Node acompanha o Prisma 7 usado no projeto. Consulte [Compatibilidade de sistemas operacionais](#compatibilidade-de-sistemas-operacionais) para distinguir ambientes testados dos avaliados.

## Instalação e execução

### Windows PowerShell

```powershell
npm install
npm run db:validate
npm run db:migrate:status
npm run build
npm start
```

Antes do build, configure PostgreSQL e `.env` conforme as seções abaixo. `npm start` inicia o servidor HTTP; a CLI original permanece disponível com `npm run start:cli`.

### Ubuntu e distribuições derivadas

Instale Node.js 22.12+ ou 24+ e npm usando a distribuição oficial do Node.js ou um gerenciador de versões confiável. Depois, na pasta do projeto:

```bash
npm install
cp .env.example .env
# Edite .env e configure DATABASE_URL e JWT_SECRET.
npm run db:validate
npm run db:migrate:status
npm run build
npm start
```

No PowerShell, copie o exemplo com `Copy-Item .env.example .env`. Em ambos os sistemas, configure o `.env` antes de iniciar; `npm start` inicia o servidor HTTP e `npm run start:cli` inicia a CLI.

O servidor valida `PORT`, conecta ao PostgreSQL antes de começar a aceitar requisições, e encerra o cliente Prisma durante o desligamento. O endpoint `GET /health` verifica a conexão com o banco e responde com status HTTP 503 se a consulta falhar.

## Prisma e PostgreSQL

O Prisma usa `prisma/schema.prisma` para o esquema e `prisma.config.ts` para ler `DATABASE_URL` do `.env`. O projeto utiliza o adapter `pg`; `src/infra/prisma/cliente.ts` expõe a criação do cliente Prisma e informa explicitamente quando a URL não está configurada.

### Tecnologias e requisitos

| Componente | Uso |
| --- | --- |
| Node.js 22.12+ na linha 22 ou 24+ e npm | Runtime, dependências, build e testes |
| TypeScript e JavaScript ESM | Código da API, CLI e scripts |
| Fastify 5 | Servidor HTTP e validação de rotas |
| PostgreSQL | Persistência da API |
| Prisma 7 com adapter `pg` | Schema, migrações e acesso ao banco |
| JWT Bearer | Autenticação da API |
| `@fastify/swagger` e Swagger UI | Documento OpenAPI e interface interativa da API |

Use uma instância PostgreSQL local ou acessível pelo ambiente. Crie o banco vazio, por exemplo:

```powershell
psql -U postgres -c "CREATE DATABASE greencode;"
Copy-Item .env.example .env
```

Configure as variáveis do `.env` antes de executar o servidor:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | Sim | URL PostgreSQL, por exemplo `postgresql://usuario:senha@localhost:5432/greencode?schema=public` |
| `JWT_SECRET` | Sim | Segredo aleatório próprio com pelo menos 32 caracteres; nunca use o placeholder do exemplo |
| `JWT_EXPIRES_IN` | Não | Duração JWT: inteiro positivo seguido de `s`, `m`, `h` ou `d`; padrão `30m` |
| `PORT` | Não | Porta HTTP entre 1 e 65535; padrão `3000` |

O `.env` é ignorado pelo Git. Não versione credenciais reais. O listener HTTP usa `127.0.0.1`; para expor o serviço a outros hosts, a configuração de rede deve ser alterada conscientemente e protegida por infraestrutura apropriada.

## Compatibilidade de sistemas operacionais

| Ambiente | Situação | Validação |
| --- | --- | --- |
| Windows 10 ou superior | Testado neste ambiente Windows | `npm test` passou (33 testes); seis migrações aplicadas; servidor HTTP e health check verificados |
| Ubuntu 24.04.03 ou superior | Compatibilidade avaliada, não executada | Código Node.js multiplataforma, scripts npm e dependências sem APIs exclusivas do Windows; requer PostgreSQL e Node.js compatível |
| Distribuições derivadas do Ubuntu | Compatibilidade avaliada, não executada | Espera-se compatibilidade quando oferecem Node.js/npm suportados, PostgreSQL acessível e dependências de sistema necessárias |

O ambiente Windows reportou Node.js v24.11.1, npm 11.6.2 e versão de sistema `10.0.26200`. O WSL disponível continha apenas a distribuição `docker-desktop`, e o daemon Linux do Docker não estava ativo; por isso, Ubuntu não foi declarado como testado. A compatibilidade Linux é uma avaliação do código e das dependências, não um teste de execução.

Em Ubuntu, instale PostgreSQL e configure uma base acessível por `DATABASE_URL` (por exemplo, usando os pacotes PostgreSQL da distribuição). Os comandos `npm install`, `npm run db:validate`, `npm run db:migrate:dev`, `npm run db:migrate:status`, `npm run build`, `npm test` e `npm start` são os mesmos; use `cp .env.example .env` no Bash. Em derivados do Ubuntu, os comandos de instalação de pacotes do sistema podem variar.

## Interface da aplicação

O projeto não possui frontend web. Atualmente há uma CLI (`npm run start:cli`) e uma API REST (`npm start`) para clientes externos; a API não inclui páginas HTML nem uma aplicação de navegador.

Após configurar uma instância PostgreSQL e preencher `DATABASE_URL`, os comandos são:

```powershell
npm run db:validate
npm run db:generate
npm run db:migrate:dev
npm run db:migrate:status
npm run db:seed
```

`npm run build` gera o Prisma Client antes de compilar o TypeScript. O schema define Organização, Contrato, Lote, Equipamento e Movimentação; Credencial, ParametroGlobal e EventoAuditoria são tabelas auxiliares para autenticação, configurações versionadas e trilha de auditoria. CNPJs normalizados e logins por estado ativo têm constraints no banco, além das validações dos services. As relações preservam o histórico de contratos e ligam organização→lotes→equipamentos→movimentações. As migrações estão em `prisma/migrations`; em desenvolvimento, use `npm run db:migrate:dev -- --name descricao` após alterações no schema e `npm run db:migrate:status` para conferir o estado.

`npm run db:seed` insere dados sintéticos de demonstração (organizações, contratos, lotes, equipamentos e movimentações) no banco definido por `DATABASE_URL`. O comando é explícito, não faz parte do build, das migrações nem da inicialização do servidor, e recusa execução com `NODE_ENV=production`. É idempotente: usa IDs estáveis, cria apenas registros ausentes, não apaga nem sobrescreve registros existentes e só preenche o vínculo do contrato seed quando ele ainda está vazio. Execute-o somente em um banco de desenvolvimento.

Em desenvolvimento, `npm run db:migrate:dev` aplica migrações pendentes e pode solicitar um nome quando o schema mudar. Em um ambiente já preparado, confira o estado com `npm run db:migrate:status` antes de iniciar.

Para criar o esquema atual de uma instalação nova em um único arquivo SQL, use `prisma/create_database.sql`. Gere ou atualize esse arquivo depois de alterar o schema com `npm run db:script`. O SQL é derivado de `prisma/schema.prisma` e contém tipos, tabelas, índices e chaves estrangeiras; pode ser aplicado somente a um banco vazio, por exemplo com `psql -d greencode -f prisma/create_database.sql`. O arquivo não cria o banco PostgreSQL nem insere dados de seed. Para bancos já gerenciados pelo Prisma, continue usando as migrações em `prisma/migrations`: elas registram a evolução do schema e não devem ser substituídas pelo SQL consolidado.

## Avaliação da importação dos arquivos legados

Os arquivos de dados da CLI em `data/` são cifrados com AES-256-GCM. A chave mestra é protegida pela senha de desbloqueio no arquivo `data/configuracao-mestre.json`; portanto, uma importação precisa da senha original para descriptografar e validar os dados. O repositório contém arquivos de organizações, lotes, equipamentos, credenciais, histórico de comandos e journal de transações, mas não foi feita uma importação nem se inspecionaram os registros descriptografados nesta etapa.

A estrutura do código permite planejar essa migração, mas a compatibilidade dos registros reais ainda não foi confirmada: isso exige validar cópias descriptografadas e definir o tratamento das credenciais e dos arquivos internos de journal/histórico. O roteiro não determina claramente que os dados reais precisem ser migrados, enquanto o seed de desenvolvimento é um requisito explícito. Por isso, nenhum importador foi adicionado ou executado nesta etapa; fazê-lo antes dessa validação poderia introduzir registros inválidos ou duplicados. Os arquivos legados foram preservados. Se a migração integral for necessária, deve ser decidida e testada separadamente usando cópias e a senha mestra fornecida localmente, sem registrá-la no repositório.

`npm test` compila o projeto e executa as suítes da CLI, API, repositories e services Prisma. Os testes de integração PostgreSQL usam o banco definido em `DATABASE_URL`; mantenha um banco de desenvolvimento disponível para executar a cobertura completa.

Os serviços Prisma em `src/services/prisma/` adaptam as regras de organizações/contratos, lotes, equipamentos, autenticação, parâmetros globais, auditoria e relatórios para persistência assíncrona. As operações relacionadas e seus eventos de auditoria são gravados na mesma transação. A criação de lote com vários equipamentos é atômica; atualizações usam controle otimista de versão e informam conflitos para que o cliente recarregue os dados. A API REST em `src/routes/api.ts` expõe esses serviços sob autenticação Bearer JWT, com permissões por papel e erros HTTP sanitizados.

## API REST

Todas as rotas, exceto `GET /health`, `POST /auth/login` e a criação inicial de credencial, exigem `Authorization: Bearer <token>`. A primeira credencial deve ser administradora; depois disso, apenas um administrador pode criar outras. O token expira conforme `JWT_EXPIRES_IN` (padrão `30m`); credenciais desativadas deixam de autenticar mesmo com token ainda válido. O servidor consulta a credencial ativa e o papel atual no banco a cada requisição protegida, sem confiar em papel enviado em claims do token.

| Grupo | Rotas principais | Acesso |
| --- | --- | --- |
| Sessão e credenciais | `POST /auth/login`, `POST /auth/credentials`, `GET /auth/credentials`, `PATCH /auth/credentials/:id/name`, `PATCH /auth/credentials/:id/role`, `PUT /auth/credentials/:id/password`, `DELETE /auth/credentials/:id`, `PUT /auth/password` | Login/criação inicial; gestão por administrador |
| Organizações e contratos | `/organizations` e `/organizations/:id/contracts` (GET, POST, PATCH, DELETE/cancelamento, renovação e encerramento) | Operador de cadastro; leitura também para auditor |
| Lotes e equipamentos | `/lots`, `/lots/with-equipment`, `/lots/:id/triage`, `/lots/:id/equipment`, `/equipment`, `/equipment/:id`, `/equipment/:id/tracking`, `status`, `physical-state` e `movements` | Gestor de almoxarifado; leitura também para auditor |
| Parâmetros globais | `GET/PATCH /global-parameters`, `GET /global-parameters/history` | Administrador |
| Relatórios | `GET /reports/status`, `/reports/organizations/:id`, `/reports/financial`, `/reports/audit` | Administrador e auditor |

Os schemas Fastify validam tipos, campos obrigatórios e extras, enums, datas ISO 8601, e-mail, valores numéricos e limites antes dos handlers. Regras específicas, como dígitos verificadores do CNPJ, existência de relações, duplicidade e transições permitidas, continuam nos serviços e no PostgreSQL. Criações retornam `201`; consultas e atualizações retornam `200`; ações sem representação retornam `204`. Erros de entrada, autenticação, autorização, ausência de recurso e conflito usam respectivamente `400`, `401`, `403`, `404` e `409`; falhas inesperadas retornam `500` sem detalhes internos. O endpoint `GET /health` permanece público e responde `503` quando o banco não está disponível.

Na primeira execução, o sistema solicita a senha do primeiro administrador, gera a chave mestra de criptografia e cria o usuário inicial `admin`.

Nas execuções seguintes, informe a senha de desbloqueio para recuperar a chave mestra e acessar os dados persistidos.

### OpenAPI, autenticação e exemplos

Com o servidor iniciado, abra `http://localhost:3000/documentation` para a Swagger UI interativa. O documento OpenAPI em JSON está disponível em `GET /documentation/json`; seus parâmetros e schemas de entrada são derivados dos schemas Fastify usados na validação.

O health check (`GET /health`) e o login (`POST /auth/login`) são públicos. As demais rotas exigem o cabeçalho `Authorization: Bearer <token>`. O token expira conforme `JWT_EXPIRES_IN` (padrão `30m`); credenciais desativadas deixam de autenticar mesmo com token ainda válido. A API consulta a credencial ativa e o papel atual no banco a cada requisição protegida e não confia em claims de papel no token.

```http
POST /auth/login
Content-Type: application/json

{"usuario":"operador","senha":"senha-local"}
```

Resposta `200` (hash e salt nunca são enviados):

```json
{
  "token": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": "30m",
  "usuario": {
    "id": "credencial-id",
    "usuario": "operador",
    "nomeExibicao": "Operador",
    "papel": "OPERADOR_CADASTRO",
    "ativo": true
  }
}
```

Use o token em outras rotas, por exemplo:

```http
GET /organizations
Authorization: Bearer <jwt>
```

Se ainda não houver credenciais no banco da API, `POST /auth/credentials` permite criar a primeira sem token, e essa conta deve ser administradora. Após essa inicialização, apenas um administrador pode criar contas. A CLI legada tem provisionamento e credenciais próprios nos arquivos locais; eles não são criados automaticamente no PostgreSQL.

### Papéis e autorização

| Papel | Permissões na API |
| --- | --- |
| `ADMINISTRADOR` | Todas as rotas, gestão de credenciais e parâmetros |
| `OPERADOR_CADASTRO` | Consulta, cadastro e manutenção de organizações e contratos |
| `GESTOR_ALMOXARIFADO` | Consulta e operação de lotes e equipamentos |
| `AUDITOR` | Consulta de organizações, lotes, equipamentos e rastreabilidade; relatórios |

Nas tabelas, `Admin` significa somente `ADMINISTRADOR`; `Cadastro` significa `ADMINISTRADOR` ou `OPERADOR_CADASTRO`; `Almoxarifado` significa `ADMINISTRADOR` ou `GESTOR_ALMOXARIFADO`; `Leitura org.` significa Cadastro ou `AUDITOR`; `Leitura op.` significa Almoxarifado ou `AUDITOR`; `Auditoria` significa `ADMINISTRADOR` ou `AUDITOR`.

### Referência de rotas

| Método e caminho | Acesso | Corpo, parâmetros ou finalidade |
| --- | --- | --- |
| `GET /health` | Público | Sem corpo; testa a conexão com PostgreSQL |
| `POST /auth/login` | Público | `{ "usuario": "...", "senha": "..." }`; emite JWT |
| `POST /auth/credentials` | Inicialização/Admin | `{ "usuario": "...", "senha": "...", "papel": "ADMINISTRADOR", "nomeExibicao": "..." }`; cria conta |
| `GET /auth/credentials` | Admin | Lista credenciais sem hash/salt |
| `GET /auth/credentials/:id` | Admin | Consulta uma credencial |
| `PATCH /auth/credentials/:id/name` | Admin | `{ "nomeExibicao": "..." }` |
| `PATCH /auth/credentials/:id/role` | Admin | `{ "papel": "AUDITOR" }` |
| `PUT /auth/credentials/:id/password` | Admin | `{ "senha": "..." }`; redefine senha |
| `DELETE /auth/credentials/:id` | Admin | Desativa a conta, preservando o histórico |
| `PUT /auth/password` | Usuário autenticado | `{ "senhaAtual": "...", "senhaNova": "..." }` |
| `GET /organizations` | Leitura org. | Query opcional `incluirDesativadas=true` |
| `POST /organizations` | Cadastro | Obrigatórios: `id`, `razaoSocial`, `cnpj`, `inscricaoEstadual`, `enderecoCompleto`, `telefone`, `email` |
| `GET /organizations/:id` | Leitura org. | Consulta organização e contratos |
| `PATCH /organizations/:id` | Cadastro | Campos cadastrais opcionais a atualizar |
| `DELETE /organizations/:id` | Cadastro | `{ "motivo": "..." }`; desativação lógica |
| `GET /organizations/:id/contracts` | Leitura org. | Lista contratos da organização |
| `POST /organizations/:id/contracts` | Cadastro | `id`, `dataAssinatura`, `dataVencimento`, `valorMensal`; `clausulas` e `renovacaoAutomatica` opcionais |
| `PATCH /organizations/:id/contracts/:contratoId` | Cadastro | `clausulas`, `valorMensal` e/ou `renovacaoAutomatica` |
| `POST /organizations/:id/contracts/renew` | Cadastro | `{ "novoVencimento": "2026-12-31T00:00:00.000Z" }` |
| `POST /organizations/:id/contracts/:contratoId/cancel` | Cadastro | Cancela contrato preservando histórico |
| `POST /organizations/:id/contracts/close` | Cadastro | Encerra o contrato vigente da organização |
| `GET /lots` | Leitura op. | Filtros: `organizacaoId`, `dataInicio`, `dataFim`, `status`, `incluirCancelados` |
| `POST /lots` | Almoxarifado | `id`, `dataEntrada`, `organizacaoId`, `notaFiscal`, `transportadora`; `observacoes` opcional |
| `POST /lots/with-equipment` | Almoxarifado | Dados de lote mais `equipamentos` (array não vazio); criação atômica |
| `GET /lots/:id` | Leitura op. | Consulta lote, organização e equipamentos |
| `PATCH /lots/:id` | Almoxarifado | Atualiza `dataEntrada`, `notaFiscal`, `transportadora` e/ou `observacoes` |
| `POST /lots/:id/triage` | Almoxarifado | Processa a triagem do lote |
| `POST /lots/:id/equipment` | Almoxarifado | Dados de um equipamento para associar ao lote |
| `DELETE /lots/:id` | Almoxarifado | `{ "motivo": "..." }`; cancela sem excluir |
| `GET /equipment` | Leitura op. | Filtros: `loteId`, `status`, `incluirCancelados` |
| `GET /equipment/:id` | Leitura op. | Consulta por ID ou código de barras |
| `GET /equipment/:id/tracking` | Leitura op. | Consulta rastreabilidade e linha do tempo |
| `PATCH /equipment/:id` | Almoxarifado | Atualiza `marca`, `modelo`, `anoFabricacao` e/ou `pesoQuilogramas` |
| `PATCH /equipment/:id/status` | Almoxarifado | `{ "status": "EM_DESMONTE" }` |
| `PATCH /equipment/:id/physical-state` | Almoxarifado | `{ "estadoFisico": "BOM_ESTADO", "justificativa": "..." }` |
| `POST /equipment/:id/movements` | Almoxarifado | `{ "destino": "..." }` |
| `POST /equipment/:id/movements/corrections` | Almoxarifado | `{ "movimentacaoId": "...", "destino": "...", "justificativa": "..." }` |
| `POST /equipment/:id/movements/reversals` | Almoxarifado | `{ "movimentacaoId": "...", "justificativa": "..." }` |
| `DELETE /equipment/:id` | Almoxarifado | `{ "motivo": "..." }`; cancela sem excluir histórico |
| `GET /global-parameters` | Admin | Consulta parâmetros atuais |
| `GET /global-parameters/history` | Admin | Consulta versões anteriores |
| `PATCH /global-parameters` | Admin | Atualiza `imposto`, `aliquota` e/ou `coeficienteDepreciacao`; valores entre 0 e 1 |
| `GET /reports/status?status=...` | Auditoria | Relatório por status de rastreamento |
| `GET /reports/organizations/:id?inicio=...&fim=...` | Auditoria | Relatório da organização por período |
| `GET /reports/financial?inicio=...&fim=...` | Auditoria | Relatório financeiro |
| `GET /reports/audit?inicio=...&fim=...` | Auditoria | Relatório de auditoria |

Para `POST /organizations`, envie por exemplo:

```json
{
  "id": "ORG-001",
  "razaoSocial": "Empresa Exemplo Ltda",
  "cnpj": "04.252.011/0001-10",
  "inscricaoEstadual": "ISENTO",
  "enderecoCompleto": "Rua Exemplo, 10 - São Paulo/SP",
  "telefone": "(11) 4000-0000",
  "email": "contato@example.invalid"
}
```

Datas usam strings ISO 8601; enums, campos obrigatórios, formatos, limites numéricos e propriedades extras são validados nos schemas da API. Entre os enums estão `papel`: `ADMINISTRADOR`, `OPERADOR_CADASTRO`, `GESTOR_ALMOXARIFADO`, `AUDITOR`; `status` de rastreamento: `AGUARDANDO_TRIAGEM`, `EM_TRIAGEM`, `AGUARDANDO_DESMONTE`, `EM_DESMONTE`, `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO`, `BAIXA_DEFINITIVA`; `estadoFisico`: `NOVO`, `BOM_ESTADO`, `USADO_LEVE`, `USADO_MODERADO`, `DANIFICADO_LEVE`, `DANIFICADO_GRAVE`, `INSERVIVEL`; e `tipo` de equipamento: `COMPUTADOR_MESA`, `NOTEBOOK`, `MONITOR`, `IMPRESSORA`, `SERVIDOR`, `ROTEADOR`, `CABO_ESTRUTURADO`, `FONTE_ALIMENTACAO`.

### Formatos de resposta e erros

Requisições e respostas usam JSON (`Content-Type: application/json`); listagens retornam arrays, consultas e criações retornam o objeto, e ações sem corpo retornam `204 No Content`. Criações retornam `201`; consultas e atualizações com representação retornam `200`. Respostas de erro têm o formato `{ "error": "CODIGO", "message": "Descrição" }`: `400` dados inválidos, `401` autenticação ausente/inválida/expirada, `403` papel sem permissão, `404` recurso inexistente, `409` duplicidade ou conflito e `500` falha interna sanitizada. `GET /health` responde `503` quando o banco está indisponível. Em conflito de atualização versionada, recarregue o recurso e tente novamente.

## Uso inicial

```text
login admin --senha SUA_SENHA

org criar --id ORG-001 --razao "Empresa Exemplo Ltda" --cnpj 04.252.011/0001-10

lote criar --id LOTE-001 --org ORG-001 --nf NF-123 --transp TransRapida

equip criar --id EQ-001 --lote LOTE-001 --tipo NOTEBOOK --marca Dell --modelo Latitude --ano 2024 --estado BOM_ESTADO --peso 1.8

lote triagem --id LOTE-001

equip mover --id EQ-001 --destino "Área de desmontagem"

rastrear EQ-001
```

Use `ajuda` dentro da aplicação para ver todos os comandos disponíveis e `menu` para visualizar apenas as operações permitidas para o usuário autenticado.

## Papéis de usuário

| Papel | Responsabilidades |
| --- | --- |
| `ADMINISTRADOR` | gerencia credenciais e acessa todas as operações disponíveis |
| `OPERADOR_CADASTRO` | mantém organizações e contratos |
| `GESTOR_ALMOXARIFADO` | cria lotes, realiza triagem e registra equipamentos e movimentações |
| `AUDITOR` | consulta rastreabilidade e gera relatórios |

As permissões são verificadas tanto no menu quanto antes da execução do serviço.

## Comandos principais

| Comando | Finalidade |
| --- | --- |
| `login USUARIO --senha SENHA` | inicia uma sessão |
| `logout` | encerra a sessão atual |
| `usuario criar --usuario U --senha S --papel PAPEL` | cria uma credencial (administrador) |
| `usuario listar` / `usuario consultar --usuario U` | consulta contas sem mostrar hashes ou salts (administrador) |
| `usuario nome --usuario U --novo NOME` / `usuario papel --usuario U --papel PAPEL` | atualiza nome de exibição ou papel (administrador) |
| `usuario senha --usuario U --nova SENHA` / `usuario desativar --usuario U` | redefine senha ou desativa conta (administrador) |
| `senha alterar --atual S --nova N` | altera a senha do usuário autenticado |
| `parametros consultar` / `parametros historico` | consulta parâmetros atuais ou suas versões anteriores (administrador) |
| `parametros atualizar [--imposto ICMS --aliquota 0.18] [--coeficiente-depreciacao 0.08]` | cria nova versão dos parâmetros; taxas usam fração entre 0 e 1 |
| `org criar ...` | cadastra uma organização |
| `org listar [--todas true]` / `org consultar --id ORG` | consulta organizações ativas ou inclui desativadas na listagem |
| `org atualizar --id ORG --razao RAZAO --cnpj CNPJ [...]` / `org desativar --id ORG --motivo MOTIVO` | atualiza dados cadastrais ou desativa sem apagar vínculos históricos |
| `contrato criar --org ORG --id CONTRATO --assinatura DATA --vencimento DATA --valor VALOR [...]` | registra o primeiro contrato ou um novo contrato após encerramento |
| `contrato listar --org ORG` / `contrato atualizar --org ORG --id CONTRATO [...]` | consulta ou altera contrato ainda não encerrado |
| `contrato cancelar --org ORG --id CONTRATO` / `org encerrar-contrato --id ORG` | encerra contrato preservando o histórico |
| `org renovar-contrato --id ORG --vencimento AAAA-MM-DD` | renova o contrato existente |
| `lote criar ...` | registra um lote de entrada |
| `lote listar [--org ORG --inicio DATA --fim DATA --status STATUS --todos true]` / `lote consultar --id LOTE` | consulta lotes com filtros; cancelados entram somente com `--todos true` |
| `lote atualizar --id LOTE [...]` | corrige dados de um lote recebido ainda sem equipamentos, sem alterar a organização vinculada |
| `lote triagem --id LOTE` | conclui a triagem do lote |
| `lote cancelar --id LOTE --motivo MOTIVO` | cancela sem apagar o lote; equipamentos ativos precisam ser cancelados antes |
| `equip criar ...` | cadastra equipamento em um lote |
| `equip listar [--lote LOTE --status STATUS --todos true]` / `equip consultar --id ID` ou `--codigo BARRAS` | consulta equipamentos por lote, status, ID ou código de barras |
| `equip atualizar --id ID [...]` / `equip cancelar --id ID --motivo MOTIVO` | corrige cadastro antes da triagem ou cancela sem apagar o histórico |
| `equip status --id ID --status STATUS` | avança pela sequência triagem, desmontagem, destinação e baixa definitiva |
| `equip mover --id EQ --destino LOCAL` | registra movimentação |
| `equip corrigir-movimentacao --id EQ --mov ID_MOV --destino LOCAL --justificativa "MOTIVO"` | registra correção sem alterar a movimentação original |
| `equip estornar-movimentacao --id EQ --mov ID_MOV --justificativa "MOTIVO"` | registra retorno ao local de origem da movimentação física mais recente |
| `equip estado --id EQ --estado ESTADO --justificativa "TEXTO"` | atualiza estado físico |
| `rastrear EQ` | mostra equipamento, lote, organização e linha do tempo de contratos, movimentações, status, estado físico e destinação |
| `relatorio status --status STATUS` | gera relatório por status |
| `relatorio organizacao --org ORG --inicio AAAA-MM-DD --fim AAAA-MM-DD` | gera relatório por organização |
| `relatorio financeiro --inicio AAAA-MM-DD --fim AAAA-MM-DD` | gera relatório financeiro |
| `relatorio auditoria --inicio AAAA-MM-DD --fim AAAA-MM-DD` | lista operações do journal por data, resultado, entidade e responsável, sem exibir snapshots de dados |

## Persistência e segurança

- Dados operacionais são cifrados com AES-256-GCM.
- Senhas usam SHA-256 com salt individual.
- A chave mestra é gerada no provisionamento e protegida por chave derivada da senha do administrador com scrypt.
- Sessões expiram após 30 minutos de inatividade.
- A persistência usa arquivo temporário e renomeação para escrita atômica.
- Cada gravação e exclusão registra uma intenção cifrada no journal antes de alterar o arquivo de dados; o resultado é registrado em seguida.
- Na inicialização, o sistema remove temporários órfãos e reaplica intenções sem desfecho.
- O journal é rotacionado ao atingir 10 MB e não é removido automaticamente, atendendo à retenção mínima de 180 dias.
- O histórico da CLI é armazenado cifrado no repositório; no primeiro início após a atualização, o histórico legado em texto é migrado e removido após a migração bem-sucedida. Comandos com campos de senha não são persistidos.

Detalhes, limitações e cenários de falha estão em [SEGURANCA_E_TESTES.md](docs/SEGURANCA_E_TESTES.md).

## Testes

```powershell
npm test
```

A suíte cobre provisionamento, contas e permissões, ciclo de contrato, recebimento e triagem de lote, destinação e rastreabilidade, correção e estorno de movimentações, versões de parâmetros, histórico da CLI cifrado, gravação atômica por arquivo, recuperação de journal e rotação. Também testa o ciclo HTTP Fastify, login e autorização JWT, health check, erros sanitizados, Swagger UI e OpenAPI. Os testes de integração usam PostgreSQL; configure `DATABASE_URL` para executar a cobertura completa.

## Estrutura

```text
src/
  cli/          Interface de linha de comando
  config/       Provisionamento e configuração mestre
  domain/       Entidades de negócio
  infra/        Criptografia, repositório e journal
  routes/       Rotas REST e schemas de validação
  repositories/ Repositories Prisma por entidade
  services/     Serviços de autenticação e domínio
  session/      Credenciais e sessões
  types/        Enums do UML
  validators/   Validadores de CNPJ e data
prisma/         Schema e migrações PostgreSQL
tests/          Testes automatizados
docs/           Documentação de segurança, testes e validação
```

## Limitações conhecidas

- O histórico de comandos não contém entradas antigas com campos de senha; a migração legada as descarta.
- Os testes exercitam serviços e persistência, mas não automatizam uma sessão interativa completa da CLI.
- A gravação atômica protege cada arquivo individualmente; operações que atualizam mais de uma entidade não têm garantia de commit atômico conjunto.
- A retenção mínima do journal é atendida por não haver expurgo automático; a execução dos testes não simula a passagem de 180 dias nem valida backups.
- Ubuntu e distribuições derivadas foram avaliados, mas não executados neste ambiente; o teste de compatibilidade realizado foi no Windows indicado na seção correspondente.
- A importação integral dos dados legados não está implementada, e não há frontend web.
- O hash de senhas usa SHA-256 com salt; antes de uso em produção, deve ser substituído por uma função própria para derivação lenta de senhas.
