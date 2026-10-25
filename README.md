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

O projeto oferece uma CLI e uma API REST. Elas são independentes: a CLI guarda seus registros em arquivos locais cifrados dentro de `data/`; a API guarda seus registros em PostgreSQL. Contas e dados não são compartilhados entre as duas modalidades.

A API não inclui uma interface web própria. A página `/documentation` fornece a documentação interativa Swagger para consultar e chamar os endpoints.

## Documentação

- [Instalação e configuração](docs/INSTALACAO.md)
- [Manual do usuário — CLI](docs/MANUAL_CLI.md)
- [Manual do usuário — API](docs/MANUAL_API.md)
- [Segurança e testes](docs/SEGURANCA_E_TESTES.md)

## Tecnologias

Node.js, TypeScript, Fastify, Prisma e PostgreSQL (API). A CLI usa armazenamento local cifrado com AES-256-GCM.
