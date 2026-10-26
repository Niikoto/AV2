# Manual do usuário — CLI

A CLI usa a API por padrão (`npm run start:cli`) e compartilha os dados PostgreSQL com a aplicação. O modo local opcional (`npm run start:cli:local`) usa armazenamento cifrado em `data/`, separado do banco e das contas da API.

## CLI conectado à API

Inicie o servidor com `npm start` e, em outro terminal, inicie `npm run start:cli`. O CLI usa `http://127.0.0.1:3000` por padrão; defina `API_BASE_URL` para apontar para outro endereço. Faça login com uma conta já cadastrada na API, por exemplo `login admin --senha SUA_SENHA`. A API valida o token e as permissões e persiste as alterações no PostgreSQL. Use `ajuda` para consultar os comandos.

## Iniciar, entrar e sair

Para usar o modo local, execute `npm run start:cli:local`. No primeiro início, defina a senha do administrador local; nos seguintes, use a senha de desbloqueio. Depois do desbloqueio, entre na sessão:

```text
login admin --senha SUA_SENHA
```

Use `ajuda` para listar comandos, `menu` para ver as opções permitidas ao seu papel, `logout` para encerrar a sessão e `sair` para fechar a CLI. A sessão expira após 30 minutos de inatividade.

Argumentos com espaços devem ficar entre aspas. Datas usam `AAAA-MM-DD`.

## Usuários e senhas

Somente administradores gerenciam credenciais. O primeiro usuário é o administrador `admin`.

```text
usuario criar --usuario LOGIN --nome "NOME" --senha SENHA --papel PAPEL
usuario listar
usuario consultar --usuario LOGIN
usuario consultar --id ID
usuario nome --usuario LOGIN --novo "NOME"
usuario papel --usuario LOGIN --papel PAPEL
usuario senha --usuario LOGIN --nova NOVA_SENHA
usuario desativar --usuario LOGIN
senha alterar --atual SENHA_ATUAL --nova NOVA_SENHA
```

Papéis: `ADMINISTRADOR`, `OPERADOR_CADASTRO`, `GESTOR_ALMOXARIFADO` e `AUDITOR`. Alterar a própria senha encerra a sessão atual; será necessário entrar novamente.

## Organizações e contratos

```text
org criar --id ID --razao "RAZÃO SOCIAL" --cnpj CNPJ [--ie IE --endereco "ENDEREÇO" --telefone TELEFONE --email EMAIL]
org listar [--todas true]
org consultar --id ID
org atualizar --id ID --razao "RAZÃO SOCIAL" --cnpj CNPJ [--ie IE --endereco "ENDEREÇO" --telefone TELEFONE --email EMAIL]
org desativar --id ID --motivo "MOTIVO"

contrato criar --org ORG --id ID --assinatura AAAA-MM-DD --vencimento AAAA-MM-DD --valor VALOR [--clausulas "A|B" --renovacao true]
contrato listar --org ORG
contrato atualizar --org ORG --id ID [--valor VALOR --clausulas "A|B" --renovacao true|false]
contrato cancelar --org ORG --id ID
org renovar-contrato --id ORG --vencimento AAAA-MM-DD
org encerrar-contrato --id ORG
```

Desativar organização e cancelar/encerrar contrato preserva os vínculos históricos.

## Lotes e triagem

```text
lote criar --id ID --org ORG --nf NOTA --transp TRANSPORTADORA [--data AAAA-MM-DD --obs "OBSERVAÇÕES"]
lote listar [--org ORG --inicio AAAA-MM-DD --fim AAAA-MM-DD --status STATUS --todos true]
lote consultar --id ID
lote atualizar --id ID [--data AAAA-MM-DD --nf NOTA --transp TRANSPORTADORA --obs "OBSERVAÇÕES"]
lote triagem --id ID
lote cancelar --id ID --motivo "MOTIVO"
```

A data do lote precisa respeitar a janela de entrada definida pelo sistema. Ao concluir a triagem, os equipamentos avançam para a etapa operacional seguinte.

Status de lote aceitos no filtro: `RECEBIDO`, `EM_TRIAGEM`, `TRIAGEM_CONCLUIDA`, `ENCAMINHADO`, `FINALIZADO`.

## Equipamentos e rastreabilidade

```text
equip criar --id ID --lote LOTE --tipo TIPO --marca MARCA --modelo MODELO --ano ANO --estado ESTADO --peso KG
equip listar [--lote LOTE --status STATUS --todos true]
equip consultar --id ID
equip consultar --codigo CODIGO_DE_BARRAS
equip atualizar --id ID [--marca MARCA --modelo MODELO --ano ANO --peso KG]
equip status --id ID --status STATUS
equip estado --id ID --estado ESTADO [--justificativa "MOTIVO"]
equip mover --id ID --destino DESTINO
equip corrigir-movimentacao --id ID --mov MOVIMENTACAO --destino DESTINO --justificativa "MOTIVO"
equip estornar-movimentacao --id ID --mov MOVIMENTACAO --justificativa "MOTIVO"
equip cancelar --id ID --motivo "MOTIVO"
rastrear ID_OU_CODIGO
```

Tipos: `COMPUTADOR_MESA`, `NOTEBOOK`, `MONITOR`, `IMPRESSORA`, `SERVIDOR`, `ROTEADOR`, `CABO_ESTRUTURADO`, `FONTE_ALIMENTACAO`.

Estados físicos: `NOVO`, `BOM_ESTADO`, `USADO_LEVE`, `USADO_MODERADO`, `DANIFICADO_LEVE`, `DANIFICADO_GRAVE`, `INSERVIVEL`.

Status de rastreamento: `AGUARDANDO_TRIAGEM`, `EM_TRIAGEM`, `AGUARDANDO_DESMONTE`, `EM_DESMONTE`, `PECAS_REAPROVEITADAS`, `MATERIAL_RECICLAVEL`, `DESCARTE_SEGURO`, `BAIXA_DEFINITIVA`.

O sistema restringe as transições de status para preservar a sequência operacional. Correções e estornos são registrados como novos eventos, mantendo o original.

## Parâmetros globais e relatórios

Parâmetros globais são exclusivos do administrador. Alíquotas e coeficiente de depreciação são frações entre 0 e 1 (por exemplo, `0.18` representa 18%).

```text
parametros consultar
parametros historico
parametros atualizar [--imposto ICMS --aliquota 0.18] [--coeficiente-depreciacao 0.08]

relatorio status --status STATUS
relatorio organizacao --org ORG --inicio AAAA-MM-DD --fim AAAA-MM-DD
relatorio financeiro --inicio AAAA-MM-DD --fim AAAA-MM-DD
relatorio auditoria --inicio AAAA-MM-DD --fim AAAA-MM-DD
```

## Permissões por papel

| Papel | Acesso principal |
| --- | --- |
| `ADMINISTRADOR` | Todas as funções, credenciais e parâmetros globais |
| `OPERADOR_CADASTRO` | Organizações e contratos |
| `GESTOR_ALMOXARIFADO` | Lotes, triagem e equipamentos |
| `AUDITOR` | Rastreabilidade e relatórios |

O menu mostra as opções do papel atual. A autorização também é conferida pela camada de serviços.
