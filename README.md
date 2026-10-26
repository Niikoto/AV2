# Greencode

Sistema de logística reversa para organizações, contratos, lotes e equipamentos. O Greencode registra a entrada de equipamentos, acompanha sua triagem, desmontagem, reaproveitamento, reciclagem ou descarte, e mantém o histórico das operações.

## O que o sistema faz

- Gerencia organizações e seus contratos.
- Registra lotes recebidos e os equipamentos associados.
- Controla triagem, estado físico, status de rastreamento e movimentações.
- Preserva histórico, correções, estornos e eventos de auditoria.
- Gera relatórios operacionais, por organização, financeiros e de auditoria.
- Controla acesso por usuário e papel.

## Duas formas de uso

O projeto oferece uma CLI conectada à API por padrão, uma CLI local opcional e uma API REST. A CLI conectada compartilha contas e dados com o PostgreSQL. A CLI local guarda registros separados em arquivos cifrados dentro de `data/`.

Para usar o CLI conectado, inicie a API com `npm start` e, em outro terminal, execute `npm run start:cli`. O endereço padrão é `http://127.0.0.1:3000`; configure `API_BASE_URL` se a API estiver em outro endereço. Entre com uma conta cadastrada na API. Para usar o modo local, execute `npm run start:cli:local`.

A API não inclui uma interface web própria. A página `/documentation` fornece a documentação interativa Swagger para consultar e chamar os endpoints.

## Documentação

- [Instalação e configuração](docs/INSTALACAO.md)
- [Manual do usuário — CLI](docs/MANUAL_CLI.md)
- [Manual do usuário — API](docs/MANUAL_API.md)
- [Segurança e testes](docs/SEGURANCA_E_TESTES.md)

## Tecnologias

Node.js, TypeScript, Fastify, Prisma e PostgreSQL (API). A CLI usa armazenamento local cifrado com AES-256-GCM.
