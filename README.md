# Greencode

Sistema de logística reversa para organizações, lotes e equipamentos. O projeto tem duas formas de uso: uma CLI legada e uma API HTTP. **Elas são independentes e não compartilham contas nem dados.**

## Requisitos

- Node.js 22.12 ou superior na linha 22, ou Node.js 24 ou superior
- npm
- PostgreSQL para usar a API

## Iniciar a API

### 1. Instalar dependências e configurar o ambiente

No PowerShell, na pasta do projeto:

```powershell
npm install
Copy-Item .env.example .env
```

Se o arquivo `.env` já existir, não o substitua. Edite-o e configure:

- `DATABASE_URL`: endereço, usuário, senha e nome do banco PostgreSQL.
- `JWT_SECRET`: um segredo próprio com pelo menos 32 caracteres. Não mantenha o valor de exemplo.
- `PORT`: opcional; por padrão, `3000`.

Exemplo de formato para a conexão (substitua os valores pelos do seu PostgreSQL):

```text
DATABASE_URL="postgresql://usuario:senha@localhost:5432/greencode?schema=public"
JWT_SECRET="coloque-aqui-um-segredo-proprio-com-mais-de-32-caracteres"
PORT=3000
```

O banco `greencode` precisa existir no PostgreSQL. Para criá-lo, se ainda não existir:

```powershell
psql -U postgres -c "CREATE DATABASE greencode;"
```

### 2. Preparar e iniciar o servidor

Com o serviço PostgreSQL ativo e o `.env` configurado:

```powershell
npm run db:validate
npm run db:migrate:dev
npm run build
npm start
```

O servidor recebe requisições em `http://localhost:3000` (ou na porta definida em `PORT`), mas não possui uma página inicial na rota `/`; acessá-la retorna `404`. Para verificar a conexão com o banco, acesse `http://localhost:3000/health`; uma resposta `200` indica que a API e o banco estão acessíveis. Para consultar e experimentar as rotas no navegador, acesse `http://localhost:3000/documentation`.

## Como chamar os métodos da API

`/documentation` é a interface Swagger para consultar e experimentar as rotas. Ela não é um frontend do sistema. Você também pode chamar os mesmos métodos usando PowerShell, `curl.exe`, Postman, Insomnia ou um frontend próprio.

### Criar a primeira conta da API

O cadastro inicial é feito no banco da API. Ele é diferente do usuário `admin` da CLI.

```powershell
$body = @{
  usuario = "admin"
  senha = "escolha-uma-senha-de-teste"
  papel = "ADMINISTRADOR"
  nomeExibicao = "Administrador"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/credentials" `
  -ContentType "application/json" `
  -Body $body
```

Essa criação sem token só funciona quando ainda não há credenciais na base. A primeira conta precisa ter o papel `ADMINISTRADOR`. Depois disso, um administrador autenticado cria contas adicionais.

### Fazer login e guardar o token

O login usa somente `usuario` e `senha`; ele não cria contas.

```powershell
$loginBody = @{
  usuario = "admin"
  senha = "escolha-uma-senha-de-teste"
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" `
  -Body $loginBody

$token = $login.token
$headers = @{ Authorization = "Bearer $token" }
```

O token expira após 30 minutos por padrão. Em Swagger, use **Authorize** e informe o token retornado pelo login.

### Exemplo: cadastrar uma organização

```powershell
$organizacao = @{
  id = "ORG-TESTE-001"
  razaoSocial = "Empresa Exemplo de Reciclagem Ltda"
  cnpj = "12.345.678/0001-95"
  inscricaoEstadual = "110.042.490.114"
  enderecoCompleto = "Rua das Flores, 100, São Paulo - SP"
  telefone = "+55 11 4000-1234"
  email = "contato@exemplo.com"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/organizations" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $organizacao
```

Troque o `id` e o CNPJ se já estiverem cadastrados na sua base.

### Exemplo: criar lote e equipamento

O lote precisa apontar para uma organização existente. Este exemplo cria lote e equipamento na mesma operação:

```powershell
$lote = @{
  id = "LOTE-TESTE-001"
  dataEntrada = "2026-10-21T12:00:00.000Z"
  organizacaoId = "ORG-TESTE-001"
  notaFiscal = "NF-TESTE-001"
  transportadora = "Transportadora Exemplo"
  observacoes = "Dados fictícios para teste"
  equipamentos = @(
    @{
      id = "EQ-TESTE-001"
      codigoBarrasInterno = "GC-TESTE-0001"
      tipo = "NOTEBOOK"
      marca = "Lenovo"
      modelo = "ThinkPad E14"
      anoFabricacao = 2022
      estadoFisico = "USADO_LEVE"
      pesoQuilogramas = 1.8
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/lots/with-equipment" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $lote
```

A data de entrada deve estar dentro do intervalo aceito pelo sistema. Os IDs e o código de barras precisam ser únicos.

### Consultar e atualizar

```powershell
# Listar organizações
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/organizations" `
  -Headers $headers

# Consultar equipamento e rastreabilidade
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/equipment/EQ-TESTE-001/tracking" `
  -Headers $headers

# Concluir a triagem do lote; os equipamentos passam a AGUARDANDO_DESMONTE
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/lots/LOTE-TESTE-001/triage" `
  -Headers $headers

# Iniciar a desmontagem após a triagem
$status = @{ status = "EM_DESMONTE" } | ConvertTo-Json
Invoke-RestMethod -Method Patch `
  -Uri "http://localhost:3000/equipment/EQ-TESTE-001/status" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $status
```

## Rotas disponíveis

Todas as rotas abaixo exigem token Bearer, exceto `GET /health`, `POST /auth/login` e a criação inicial em `POST /auth/credentials`.

| Área | Métodos e rotas |
| --- | --- |
| Credenciais | `/auth/credentials`, `/auth/credentials/:id`, `/auth/credentials/:id/name`, `/auth/credentials/:id/role`, `/auth/credentials/:id/password`, `/auth/password` |
| Organizações e contratos | `/organizations`, `/organizations/:id`, `/organizations/:id/contracts` e rotas de renovação, cancelamento e encerramento |
| Lotes | `/lots`, `/lots/with-equipment`, `/lots/:id`, `/lots/:id/triage`, `/lots/:id/equipment` |
| Equipamentos | `/equipment`, `/equipment/:id`, `/equipment/:id/tracking`, `/equipment/:id/status`, `/equipment/:id/physical-state`, `/equipment/:id/movements` |
| Parâmetros e relatórios | `/global-parameters`, `/global-parameters/history`, `/reports/status`, `/reports/organizations/:id`, `/reports/financial`, `/reports/audit` |

Consulte `http://localhost:3000/documentation` para ver os métodos HTTP, campos, enums, permissões e exemplos completos. Em geral, a API responde `200` para consultas/atualizações, `201` para criações e `204` para operações sem corpo de resposta. Erros comuns incluem `400` (dados inválidos), `401` (sem autenticação), `403` (sem permissão), `404` (registro inexistente) e `409` (duplicidade ou conflito).

## CLI legada: armazenamento separado

Para iniciar a CLI:

```powershell
npm run start:cli
```

No primeiro uso, ela pede a senha do administrador local e cria a conta `admin`. Usuários, organizações, lotes e equipamentos da CLI são armazenados em arquivos cifrados dentro de `data/`. **Esses dados e contas não são lidos pela API nem gravados no PostgreSQL.** A API tem seu próprio cadastro de credenciais pelo endpoint `POST /auth/credentials`.

## Banco, seed e testes

O seed opcional insere dados sintéticos de demonstração no banco configurado em `DATABASE_URL`:

```powershell
npm run db:seed
```

Ele não cria usuário administrador; crie a primeira conta usando `POST /auth/credentials`. O seed não deve ser executado em produção.

Para executar os testes automatizados:

```powershell
npm test
```

Os testes que usam Prisma precisam de um PostgreSQL acessível e de um banco de desenvolvimento configurado em `DATABASE_URL`. Não use um banco com dados importantes para testes.

## Compatibilidade

O projeto usa Node.js, TypeScript, Fastify e Prisma, e foi preparado para Windows 10 ou superior, Ubuntu 24.04.03 ou superior e distribuições derivadas do Ubuntu. A compatibilidade Linux deve ser validada no ambiente de destino; são necessários Node.js/npm e PostgreSQL compatíveis.
