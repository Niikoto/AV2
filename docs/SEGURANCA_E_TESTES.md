# Greencode — Segurança e testes

## Arquitetura de segurança

### Criptografia dos dados

`RepositorioArquivo` persiste organizações, lotes, equipamentos, credenciais e journal. Antes da escrita, converte as entidades para JSON e usa `CriptografiaArquivo.cifrar`.

O algoritmo é AES-256-GCM: uma chave de 256 bits, IV aleatório de 12 bytes e tag de autenticação. O arquivo contém `iv.tag.conteudo`, em Base64. AES-256 é padronizado e disponível nativamente no Node.js; GCM também detecta alteração do conteúdo cifrado, não apenas leitura indevida.

A escrita é atômica: o repositório escreve primeiro um arquivo temporário no mesmo diretório e depois o renomeia para o arquivo definitivo. Se a gravação ou renomeação falhar, o temporário é removido e o arquivo anterior permanece. A configuração mestre também usa temporário exclusivo e limpa o arquivo incompleto em caso de erro.

### Senhas

`Credencial` armazena um identificador interno, login, nome de exibição, hash, salt, último acesso, papel e estado ativo; nunca a senha em texto puro. Login e nome de exibição são campos separados. `ServicoAutenticacao` gera um salt aleatório de 16 bytes por usuário e calcula SHA-256 sobre `salt:senha`.

O salt impede que usuários com a mesma senha tenham o mesmo hash e reduz a utilidade de tabelas pré-calculadas. SHA-256 impede recuperar diretamente a senha a partir do hash. Limitação: SHA-256 é rápido; para um sistema de produção, uma função lenta de senha, como scrypt, bcrypt ou Argon2, é mais resistente a tentativas massivas.

### Chave mestra e provisionamento

No primeiro uso, `ProvisionamentoInicial` detecta a ausência de `configuracao-mestre.json`, exige a senha do primeiro administrador e gera uma chave mestra aleatória de 32 bytes.

A chave mestra não é gravada diretamente. A senha do administrador e um salt aleatório de 16 bytes alimentam `scrypt`, que deriva a chave de proteção. A chave mestra é então cifrada com AES-256-GCM e persistida na configuração mestre.

Limitações:

- Se a senha do administrador for perdida, esta implementação não recupera a chave mestra nem os dados.
- O arquivo mestre precisa de proteção do sistema operacional e de backup contra exclusão ou substituição.
- O histórico da CLI é salvo no repositório cifrado e comandos com campos de senha são descartados. Na próxima inicialização, o arquivo legado `historico-comandos.txt` é migrado e removido somente depois que a gravação cifrada termina com sucesso.

### Sessões e permissões

O login cria uma `Sessao` com token aleatório, usuário, papel, criação e expiração. A expiração inicial é de 30 minutos. Cada validação de token bem-sucedida chama `Sessao.renovar`, portanto o período é de inatividade, não de duração total da sessão.

Trinta minutos reduzem a exposição de um terminal abandonado sem exigir autenticação para cada comando. A CLI valida token e permissão antes de delegar cada operação. Os métodos de gestão de credenciais também validam token e papel administrador dentro de `ServicoAutenticacao`; esconder opções no menu não é a única proteção. O auditor não pode alterar senha, pois seu papel é somente leitura.

Na API, o login emite JWT Bearer assinado por `JWT_SECRET` e com expiração de `JWT_EXPIRES_IN` (30 minutos por padrão). A chave deve ser própria e ter ao menos 32 caracteres. Cada requisição protegida verifica o JWT e consulta a credencial ativa no banco; o papel atual, não o papel copiado para um token antigo, é usado para autorizar a ação. As rotas passam o ID autenticado aos services para autoria da auditoria. Testes verificam token ausente, inválido e expirado, usuário inexistente ou desativado, claims de papel forjadas e mudanças de papel sem novo login. Desativar credenciais invalida seu acesso imediatamente; não há logout por revogação de JWT, portanto clientes devem descartar o token ao sair e aguardar sua expiração se ele for perdido.

Ao desativar uma conta, o sistema revoga as sessões e limpa login, nome de exibição, hash e salt do registro corrente. A intenção de desativação no journal também omite esses dados. Entradas anteriores do journal permanecem cifradas e preservadas para auditoria; elas podem conter o login e nome de exibição existentes quando a conta foi criada ou alterada.

| Papel | Operações na CLI |
| --- | --- |
| `ADMINISTRADOR` | credenciais, organizações, contratos, lotes, equipamentos, rastreabilidade e relatórios |
| `OPERADOR_CADASTRO` | organizações e contratos |
| `GESTOR_ALMOXARIFADO` | lotes, triagem, equipamentos e movimentações |
| `AUDITOR` | rastreabilidade e relatórios |

Parâmetros globais são acessíveis somente ao `ADMINISTRADOR`. Na CLI, cada alteração cria um novo registro cifrado e journalizado. No serviço Prisma, cada alteração cria uma versão PostgreSQL e um evento de auditoria na mesma transação, mantendo versões anteriores. As atualizações concorrentes são serializadas pelo banco; conflitos de serialização ou de versão são informados ao chamador. Alíquotas são identificadas pelo administrador (por exemplo, `ICMS`) e informadas como fração entre 0 e 1; o coeficiente de depreciação segue o mesmo intervalo. O valor inicial do coeficiente é 0,08 e a lista de alíquotas começa vazia, pois o enunciado não fixa tributos ou percentuais.

## Journal e retenção

`JournalTransacao` também é persistido pelo repositório e, portanto, cifrado. Toda gravação ou exclusão de entidade segue esta sequência:

1. Gravar atomicamente uma intenção com os dados anteriores e posteriores.
2. Aplicar a alteração ou exclusão no arquivo da entidade.
3. Acrescentar um evento de confirmação; se a aplicação falhar, acrescentar um evento de aborto.

Os eventos são acrescentados, não sobrescritos. Se o processo cair depois da intenção e antes do desfecho, na próxima inicialização o sistema reaplica os dados posteriores de forma idempotente e registra a confirmação. Temporários órfãos são removidos antes dessa recuperação. Se a tentativa de registrar o aborto também falhar, a intenção permanece pendente e será concluída na próxima inicialização; nesse caso, o comando pode ter retornado erro embora a operação seja aplicada na recuperação.

Ao atingir 10 MB, o arquivo corrente é renomeado com um identificador único e um novo arquivo recebe os registros. A consulta percorre os arquivos cujo nome começa com `journal-transacoes`. O sistema não expurga journals automaticamente: a política é retenção indefinida, portanto superior ao mínimo de 180 dias. A organização deve manter o diretório e seus backups; rotação não é exclusão.

## Execução dos testes

Execute na raiz do projeto:

```powershell
npm test
```

O comando compila o TypeScript e executa os testes da CLI, do servidor, dos repositories e dos serviços Prisma. Os cenários de arquivo usam diretórios temporários. Os testes PostgreSQL usam identificadores exclusivos e removem os registros criados; configure `DATABASE_URL` para executá-los.

## Cenários de falha testados

| Cenário | Resposta do sistema | Resultado |
| --- | --- | --- |
| CNPJ inválido ou duplicado | cadastro rejeitado | Testado |
| Data de entrada futura ou anterior a 90 dias | criação de lote rejeitada | Testado |
| Queda de duas categorias no estado físico sem justificativa | alteração rejeitada; com justificativa, alteração e evento persistidos | Testado |
| Senha incorreta, falta de permissão ou sessão expirada | autenticação/operação rejeitada | Testado |
| Gestão de contas | consulta sem hash/salt, atualização de nome e papel, redefinição de senha e desativação com referência histórica anonimizada | Testado |
| Contrato na jornada | cadastro e alteração de valor aparecem no contexto rastreável | Testado |
| Desmontagem antes da triagem | transição para `EM_DESMONTE` rejeitada | Testado |
| Jornada operacional | provisionamento, usuário, organização e contrato, lote, equipamento, triagem, desmontagem, destinação, baixa, correção, autoria, rastreabilidade e journal confirmado | Testado |
| Estorno de movimentação | evento original mantido, estorno vinculado e localização retornada à origem | Testado |
| Parâmetros globais | controle de acesso administrativo e versões históricas de alíquota e coeficiente | Testado |
| Histórico de comandos | conteúdo gravado cifrado e recuperável pelo repositório | Testado |
| Escrita atômica bem-sucedida | arquivo temporário removido após a gravação | Testado |
| Falha antes da renomeação | arquivo de dados inalterado, temporário removido e aborto registrado | Testado |
| Intenção sem desfecho | recuperação reaplica os dados e uma segunda recuperação não repete a operação | Testado |
| Temporário órfão | removido na inicialização simulada sem alterar o arquivo definitivo | Testado |
| Rotação do journal | arquivo sintético no limite de 10 MB é rotacionado antes do próximo registro | Testado |
| Servidor e banco | inicialização conectada, `GET /health`, listener HTTP e encerramento/desconexão | Testado com PostgreSQL local |
| API REST | autenticação e autorização JWT, validação, criação/consulta/atualização/desativação lógica, duplicidade, recurso inexistente e sanitização de erros de persistência | Testado com injeção Fastify e Prisma simulado; os serviços têm testes PostgreSQL separados |
| OpenAPI/Swagger UI | JSON OpenAPI, schemas de entrada, requisitos JWT por rota e interface de documentação | Testado por requisições HTTP Fastify |
| Login JWT da API | comparação de hash de senha, emissão de token com `sub`/`iat`/`exp`, acesso com Bearer, senha incorreta e token inválido/expirado | Testado com PostgreSQL local |
| Proteção de rotas | token ausente/inválido/expirado, credencial desativada, identidade consultada e permissão calculada com o papel atual no banco | Testado com Fastify/Prisma simulado e integração PostgreSQL |
| Falha de conexão no health check | `503` sem detalhes internos na resposta | Testado com falha simulada |
| Falha ao conectar ou abrir porta | inicialização abortada e cliente Prisma desconectado | Testado |
| Erro de rota e endpoint inexistente | respostas `500` sanitizada e `404` padronizada | Testado |
| Repositories Prisma | CRUD básico e consultas de relacionamentos dentro de transação revertida | Testado com PostgreSQL local |
| Serviços Prisma de autenticação | autorização administrativa, resposta sem hash/salt, alteração e redefinição de senha, permissões, desativação e proteção do último administrador | Testado com PostgreSQL local |
| Constraints concorrentes Prisma | CNPJ com formatos diferentes e criação concorrente do mesmo login ativo não geram duplicatas | Testado com PostgreSQL local |
| Jornada de serviços Prisma | organização, contrato e renovação, lote, equipamento, triagem e registro transacional de mudança de status | Testado com PostgreSQL local |
| Transações e concorrência Prisma | criação de lote e equipamentos atomicamente, rollback em falha, conflitos otimistas em entidades mutáveis e atualização concorrente de parâmetros globais | Testado com PostgreSQL local |
| Parâmetros globais e auditoria Prisma | validação de autorização e taxas, histórico versionado e registro de auditoria atômico com a alteração | Testado com PostgreSQL local |
| Relatórios Prisma de auditoria/financeiro | operações auditadas no período e contagem de transações no relatório financeiro | Testado com PostgreSQL local |

### Validação integrada — 20/10/2026

- `npm test`: 32 testes aprovados, nenhum falhou ou foi ignorado.
- `npm run db:migrate:status`: as seis migrações estão aplicadas e o schema está atualizado.
- `npm run db:seed`: executado novamente sem duplicar ou sobrescrever os registros de demonstração.
- Servidor iniciado em porta local com a configuração normal; `GET /health` confirmou PostgreSQL conectado e `GET /organizations` sem JWT retornou `401`.
- O `.env` local continha o segredo JWT de exemplo, que impede a inicialização; o placeholder foi substituído por uma chave aleatória local. O arquivo permanece ignorado pelo Git e o valor não é documentado nem versionado.

### Documentação OpenAPI — 20/10/2026

- `npm test`: valida `GET /documentation/json`, a presença das rotas e schemas gerados, os requisitos de segurança Bearer JWT e a interface Swagger UI.
- A referência em português, incluindo requisitos, variáveis, configuração do banco, migrações, seed, inicialização, papéis, rotas e formatos de resposta, está em `README.md`.

### Compatibilidade — 20/10/2026

- Testado em Windows com Node.js v24.11.1, npm 11.6.2 e PostgreSQL local: build e `npm test` aprovados (33/33); as seis migrações estavam aplicadas.
- Ubuntu 24.04.03+ e derivados foram avaliados por inspeção das APIs Node utilizadas e das dependências, mas não foram executados. O WSL só tinha a distribuição `docker-desktop` e o daemon Docker Linux não estava ativo.
- O runtime mínimo declarado no `package.json` é Node.js 22.12+ na linha 22 ou 24+. Consultar o README para requisitos de ambiente e comandos por plataforma.

### Revisão final — 20/10/2026

- `npm run db:validate`: schema Prisma válido.
- `npm run build` e `npm test`: build concluído; 33 testes aprovados, 0 falhas e 0 ignorados.
- `npm run db:migrate:status`: seis migrações aplicadas; schema atualizado.
- `npm run db:seed`: executado no banco local de desenvolvimento; as contagens permaneceram em 2 organizações, 2 contratos, 2 lotes, 4 equipamentos e 5 movimentações. Consultas confirmaram os vínculos do seed entre organizações/contratos, organizações/lotes, lotes/equipamentos e equipamentos/movimentações.
- `npm start`: iniciado e validado por HTTP; `/health` e `/documentation` responderam `200`, PostgreSQL foi confirmado conectado, OpenAPI publicou 34 caminhos e uma rota de negócio sem token respondeu `401`.
- `npm audit --omit=dev`: nenhuma vulnerabilidade reportada nas dependências de produção; `npm ls --depth=0`: dependências instaladas conforme o manifesto.
- Varredura de padrões de credenciais não encontrou candidatos em código, testes ou configuração; `.env` está ignorado pelo Git.
- Os arquivos originais de configuração mestre, credenciais, organizações, lotes, equipamentos, histórico e journal permanecem presentes. Não foram descriptografados nem alterados nesta revisão.

Pendências e decisões a confirmar: a importação de dados legados permanece opcional e não implementada; não existe frontend web; o hash de senha atual usa SHA-256 com salt e não é adequado como estratégia final para produção. Confirmar com o professor se a interface web e a migração dos dados reais são requisitos da entrega.

### Validação em Linux — 24/10/2026

- Executado em Ubuntu 24.04.5 LTS (WSL), Node.js v24.11.1, npm 11.6.2 e PostgreSQL 16.15.
- `npm ci`, geração do cliente Prisma e `npm run build` concluíram na cópia Linux do projeto.
- As sete migrações versionadas foram aplicadas com `prisma migrate deploy` em banco PostgreSQL descartável.
- `npm test`: 33 testes aprovados, 0 falhas e 0 ignorados, incluindo integrações com PostgreSQL.
- A API iniciou como servidor Linux. `/health`, `/documentation` e `/documentation/json` responderam `200`; o OpenAPI listou 35 caminhos; uma rota protegida sem token respondeu `401`.
- Fluxo HTTP de credenciais e sessão: criação inicial `201`, login `200`, consulta autenticada antes do logout `200`, logout `204` e token revogado depois do logout `401`.
- A CLI iniciou, provisionou o administrador local, desbloqueou os dados, autenticou e executou `logout` com sucesso.
- `npm audit --omit=dev` reportou uma vulnerabilidade moderada na dependência transitiva `fast-uri`. O alerta afeta dependências de produção e precisa ser avaliado em atualização própria.
- A validação usou cópia do projeto em Linux e banco descartável; o banco e seu usuário foram removidos ao final. Ubuntu, Node.js e PostgreSQL foram instalados no WSL; o serviço PostgreSQL foi parado após a validação.

## Limitações e escopo de validação

- Os testes são de serviços e persistência; não automatizam uma sessão interativa completa da CLI nem todas as mensagens e caminhos de menu.
- Os serviços Prisma estão expostos pela API REST e coexistem com os serviços legados da CLI, que continuam usando os arquivos criptografados.
- A aplicação não contém frontend web; oferece a CLI legada e a API REST.
- A importação dos arquivos legados foi avaliada, mas não implementada nem executada. Os dados em `data/` dependem da senha de desbloqueio para descriptografia AES-256-GCM. Como a exigência de migração integral não está explícita e o conteúdo não foi validado em cópias, os arquivos originais permanecem intactos; veja a seção “Avaliação da importação dos arquivos legados” no README.
- A API valida a forma dos dados com schemas Fastify e deixa regras de domínio (como CNPJ, existência de vínculos, unicidade e transições) nos serviços e constraints do banco. Erros conhecidos do Prisma são convertidos em respostas HTTP sem mensagens internas do banco; falhas inesperadas retornam erro genérico.
- As operações mutáveis dos serviços Prisma gravam eventos de auditoria na mesma transação da alteração; falhas na operação ou no registro revertem ambas. A autoria pode ser passada às operações que aceitam `responsavel`; os métodos sem esse argumento registram `sistema`.
- Os testes automatizados validam o ciclo HTTP com Fastify em processo e o acesso real ao PostgreSQL local. O encerramento é verificado por `app.close()` e pelo hook do Prisma; não simulam sinais do sistema operacional em todos os ambientes.
- A falha de escrita é injetada antes da renomeação. A recuperação de intenção pendente é simulada gravando uma intenção sem desfecho; não é um teste de desligamento forçado do processo, falta real de espaço ou falha física de disco.
- A atomicidade entre múltiplas entidades está implementada nos serviços Prisma através de transações PostgreSQL. A CLI legada persiste em arquivos e mantém o journal como mecanismo de recuperação; ela não usa transações Prisma.
- A retenção de 180 dias não expira automaticamente: a política implementada é não remover journals. O teste verifica a rotação por tamanho, mas não a leitura dos arquivos rotacionados, a passagem do tempo, a conservação operacional ou a existência de backups.
- O teste do histórico da CLI verifica que os dados salvos no repositório não ficam em texto puro. A filtragem de comandos com senha e a migração do arquivo legado são comportamentos documentados, mas não têm teste automatizado dedicado.
- As credenciais ainda usam SHA-256 com salt para hash de senha. Conforme descrito acima, isso não equivale a uma função lenta de derivação de senha adequada a produção.

## Comandos principais

```text
login USUARIO --senha SENHA
org criar --id ID --razao "RAZÃO" --cnpj CNPJ
lote criar --id ID --org ORG --nf NF --transp TRANSPORTADORA
equip criar --id ID --lote LOTE --tipo TIPO --marca MARCA --modelo MODELO --ano ANO --estado ESTADO --peso KG
lote triagem --id LOTE
equip mover --id EQUIPAMENTO --destino DESTINO
rastrear EQUIPAMENTO
relatorio status --status STATUS
```

Use `ajuda` dentro da aplicação para ver todos os comandos e valores de enums aceitos.
