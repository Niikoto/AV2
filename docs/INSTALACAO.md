# Instalação e configuração

## Requisitos comuns

- Node.js 22.12 ou superior na linha 22, ou Node.js 24 ou superior.
- npm.
- Windows 10 ou superior, ou uma distribuição Linux com suporte ao Node.js. Ubuntu 24.04 LTS foi validado em execução. Linux Mint 22.x usa a base Ubuntu 24.04 e deve ser compatível, mas não foi validado diretamente.

Os comandos `npm` são os mesmos no PowerShell do Windows e no terminal Linux. Execute-os na pasta raiz do projeto. Instale Node.js e npm pelos meios recomendados para o seu sistema operacional.

Instale as dependências do projeto e compile:

```sh
npm install
npm run build
```

## Instalar e iniciar a CLI

A CLI não exige PostgreSQL. Depois de instalar as dependências e compilar o projeto, inicie-a:

```sh
npm run start:cli
```

No primeiro uso, informe a senha do administrador inicial; nos usos seguintes, informe a senha de desbloqueio. O sistema cria a conta local `admin` e usa essa senha para proteger a chave mestra dos arquivos. Os dados da CLI permanecem em `data/` e não são importados automaticamente para a API.

Consulte o [Manual do usuário — CLI](MANUAL_CLI.md) para as operações disponíveis.

## Instalar e iniciar a API

A API requer PostgreSQL instalado e em execução, além de Node.js e npm. Confirme que `psql` está disponível no terminal.

### Configurar o ambiente

Crie o arquivo `.env` a partir do exemplo, sem substituir um arquivo já existente. No Linux:

```sh
test -e .env || cp .env.example .env
```

No PowerShell do Windows:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Configure as variáveis no `.env`:

```text
DATABASE_URL=postgresql://usuario:senha@localhost:5432/greencode?schema=public
JWT_SECRET=use-um-segredo-proprio-com-pelo-menos-32-caracteres
PORT=3000
JWT_EXPIRES_IN=30m
```

`DATABASE_URL` e `JWT_SECRET` são necessários para a API. `PORT` e `JWT_EXPIRES_IN` são opcionais. Não use o segredo de exemplo em produção.

### Criar banco e iniciar o servidor

Crie o banco se necessário. No Linux com PostgreSQL local:

```sh
sudo -u postgres psql -c "CREATE DATABASE greencode;"
```

No Windows, usando uma instalação local padrão do PostgreSQL:

```powershell
psql -U postgres -c "CREATE DATABASE greencode;"
```

Valide o schema, aplique as migrações e inicie o servidor:

```sh
npm run db:validate
npm run db:migrate:dev
npm start
```

O servidor inicia em `http://localhost:3000` (ou na porta de `PORT`). `GET /health` verifica API e banco; `/documentation` abre o Swagger. A rota `/` não tem página inicial.

O primeiro usuário da API é criado pelo endpoint `POST /auth/credentials`, sem token, somente quando ainda não houver credenciais; esse primeiro usuário precisa ser `ADMINISTRADOR`. Veja o [Manual do usuário — API](MANUAL_API.md).

## Desenvolvimento da API: seed e testes

Esta seção é voltada ao ambiente de desenvolvimento da API. Configure `DATABASE_URL` para um banco PostgreSQL de desenvolvimento sem dados importantes.

O seed insere dados sintéticos no banco indicado por `DATABASE_URL`; não cria o administrador e não deve ser executado em produção:

```sh
npm run db:seed
```

Para executar a suíte automatizada, mantenha configurado o banco de desenvolvimento:

```sh
npm test
```

## Arquivos de referência

- `.env.example`: nomes e formato das configurações da API.
- `prisma/schema.prisma`: estrutura de dados do PostgreSQL.
- `prisma/migrations/`: histórico de alterações do schema.
- [Segurança e testes](SEGURANCA_E_TESTES.md): controles, limitações e cenários cobertos.
