import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

type Papel = 'ADMINISTRADOR' | 'OPERADOR_CADASTRO' | 'GESTOR_ALMOXARIFADO' | 'AUDITOR';
type UsuarioApi = { id: string; usuario: string; nomeExibicao: string; papel: Papel };

export class ApiCLIInterface {
  private token: string | null = null;
  private usuario: UsuarioApi | null = null;
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  iniciarLoop(): void {
    const cli = createInterface({ input: process.stdin, output: process.stdout, prompt: 'greencode-api> ' });
    console.log(`[INFO] CLI conectado à API ${this.baseUrl}. Use ajuda.`);
    cli.prompt();
    cli.on('line', (line) => {
      if (line.trim().toLowerCase() === 'sair') {
        cli.close();
        return;
      }
      void this.processar(line).finally(() => cli.prompt());
    });
    cli.on('close', () => process.exit(0));
  }

  private async processar(line: string): Promise<void> {
    const tokens = line.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
    const [cmd = '', action = '', ...rest] = tokens;
    const options: Record<string, string> = {};
    for (let i = 0; i < rest.length; i += 2) if (rest[i]?.startsWith('--')) options[rest[i].slice(2)] = rest[i + 1] ?? '';
    try {
      if (!cmd) return;
      if (cmd === 'ajuda') return this.help();
      if (cmd === 'login') {
        const result = await this.call<{ token: string; usuario: UsuarioApi }>('/auth/login', 'POST', {
          usuario: action,
          senha: this.required(options, 'senha'),
        }, false);
        this.token = result.token;
        this.usuario = result.usuario;
        return this.show('SUCESSO', `Login efetuado para ${result.usuario.usuario}.`);
      }
      if (cmd === 'logout') {
        if (this.token) await this.call('/auth/logout', 'POST');
        this.token = null;
        this.usuario = null;
        return this.show('SUCESSO', 'Sessão encerrada.');
      }
      if (cmd === 'menu') {
        this.requireSession();
        const menu: Record<Papel, string> = {
          ADMINISTRADOR: 'usuários, senha, parâmetros, organizações, contratos, lotes, equipamentos, rastreamento e relatórios',
          OPERADOR_CADASTRO: 'senha, organizações e contratos',
          GESTOR_ALMOXARIFADO: 'senha, lotes e equipamentos',
          AUDITOR: 'rastreamento e relatórios',
        };
        return this.show('INFO', `Opções para ${this.usuario!.papel}: ${menu[this.usuario!.papel]}`);
      }

      let result: unknown;
      let success = 'Operação concluída.';
      if (cmd === 'usuario' && action === 'criar') {
        result = await this.call('/auth/credentials', 'POST', { usuario: this.required(options, 'usuario'), senha: this.required(options, 'senha'), papel: this.required(options, 'papel'), nomeExibicao: options.nome ?? options.usuario });
        success = 'Credencial criada.';
      } else if (cmd === 'usuario' && action === 'listar') result = await this.call('/auth/credentials');
      else if (cmd === 'usuario' && action === 'consultar') {
        const id = options.id ?? await this.findCredentialId(this.required(options, 'usuario'));
        result = await this.call(`/auth/credentials/${encodeURIComponent(id)}`);
      } else if (cmd === 'usuario' && action === 'nome') {
        const id = await this.findCredentialId(this.required(options, 'usuario'));
        result = await this.call(`/auth/credentials/${encodeURIComponent(id)}/name`, 'PATCH', { nomeExibicao: this.required(options, 'novo') });
        success = 'Nome de exibição atualizado.';
      } else if (cmd === 'usuario' && action === 'papel') {
        const id = await this.findCredentialId(this.required(options, 'usuario'));
        result = await this.call(`/auth/credentials/${encodeURIComponent(id)}/role`, 'PATCH', { papel: this.required(options, 'papel') });
        success = 'Papel atualizado.';
      } else if (cmd === 'usuario' && action === 'senha') {
        const id = await this.findCredentialId(this.required(options, 'usuario'));
        result = await this.call(`/auth/credentials/${encodeURIComponent(id)}/password`, 'PUT', { senha: this.required(options, 'nova') });
        success = 'Senha redefinida.';
      } else if (cmd === 'usuario' && action === 'desativar') {
        const id = await this.findCredentialId(this.required(options, 'usuario'));
        result = await this.call(`/auth/credentials/${encodeURIComponent(id)}`, 'DELETE');
        success = 'Conta desativada.';
      } else if (cmd === 'senha' && action === 'alterar') {
        result = await this.call('/auth/password', 'PUT', { senhaAtual: this.required(options, 'atual'), senhaNova: this.required(options, 'nova') });
        this.token = null;
        this.usuario = null;
        success = 'Senha alterada. Entre novamente com a nova senha.';
      } else if (cmd === 'parametros' && action === 'consultar') result = await this.call('/global-parameters');
      else if (cmd === 'parametros' && action === 'historico') result = await this.call('/global-parameters/history');
      else if (cmd === 'parametros' && action === 'atualizar') {
        result = await this.call('/global-parameters', 'PATCH', { imposto: options.imposto, aliquota: this.optionalNumber(options.aliquota), coeficienteDepreciacao: this.optionalNumber(options['coeficiente-depreciacao']) });
      } else if (cmd === 'org' && action === 'criar') {
        result = await this.call('/organizations', 'POST', { id: this.required(options, 'id'), razaoSocial: this.required(options, 'razao'), cnpj: this.required(options, 'cnpj'), inscricaoEstadual: options.ie ?? '', enderecoCompleto: this.required(options, 'endereco'), telefone: this.required(options, 'telefone'), email: this.required(options, 'email') });
        success = 'Organização cadastrada.';
      } else if (cmd === 'org' && action === 'listar') result = await this.call(`/organizations${this.query({ incluirDesativadas: options.todas === 'true' ? 'true' : undefined })}`);
      else if (cmd === 'org' && action === 'consultar') result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'id'))}`);
      else if (cmd === 'org' && action === 'atualizar') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'id'))}`, 'PATCH', this.defined({ razaoSocial: options.razao, cnpj: options.cnpj, inscricaoEstadual: options.ie, enderecoCompleto: options.endereco, telefone: options.telefone, email: options.email }));
        success = 'Organização atualizada.';
      } else if (cmd === 'org' && action === 'desativar') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'id'))}`, 'DELETE', { motivo: this.required(options, 'motivo') });
        success = 'Organização desativada.';
      } else if (cmd === 'org' && action === 'renovar-contrato') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'id'))}/contracts/renew`, 'POST', { novoVencimento: this.date(options, 'vencimento') });
      } else if (cmd === 'org' && action === 'encerrar-contrato') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'id'))}/contracts/close`, 'POST');
      } else if (cmd === 'contrato' && action === 'criar') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'org'))}/contracts`, 'POST', { id: this.required(options, 'id'), dataAssinatura: this.date(options, 'assinatura'), dataVencimento: this.date(options, 'vencimento'), clausulas: this.list(options.clausulas), valorMensal: this.number(options, 'valor'), renovacaoAutomatica: options.renovacao === undefined ? undefined : options.renovacao === 'true' });
        success = 'Contrato cadastrado.';
      } else if (cmd === 'contrato' && action === 'listar') result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'org'))}/contracts`);
      else if (cmd === 'contrato' && action === 'atualizar') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'org'))}/contracts/${encodeURIComponent(this.required(options, 'id'))}`, 'PATCH', this.defined({ clausulas: options.clausulas === undefined ? undefined : this.list(options.clausulas), valorMensal: this.optionalNumber(options.valor), renovacaoAutomatica: options.renovacao === undefined ? undefined : options.renovacao === 'true' }));
      } else if (cmd === 'contrato' && action === 'cancelar') {
        result = await this.call(`/organizations/${encodeURIComponent(this.required(options, 'org'))}/contracts/${encodeURIComponent(this.required(options, 'id'))}/cancel`, 'POST');
      } else if (cmd === 'lote' && action === 'criar') {
        result = await this.call('/lots', 'POST', { id: this.required(options, 'id'), organizacaoId: this.required(options, 'org'), notaFiscal: this.required(options, 'nf'), transportadora: this.required(options, 'transp'), dataEntrada: options.data ? this.date(options, 'data') : new Date().toISOString(), observacoes: options.obs });
        success = 'Lote criado.';
      } else if (cmd === 'lote' && action === 'listar') result = await this.call(`/lots${this.query({ organizacaoId: options.org, dataInicio: options.inicio ? this.date(options, 'inicio') : undefined, dataFim: options.fim ? this.date(options, 'fim', true) : undefined, status: options.status, incluirCancelados: options.todos === 'true' ? 'true' : undefined })}`);
      else if (cmd === 'lote' && action === 'consultar') result = await this.call(`/lots/${encodeURIComponent(this.required(options, 'id'))}`);
      else if (cmd === 'lote' && action === 'atualizar') result = await this.call(`/lots/${encodeURIComponent(this.required(options, 'id'))}`, 'PATCH', this.defined({ dataEntrada: options.data ? this.date(options, 'data') : undefined, notaFiscal: options.nf, transportadora: options.transp, observacoes: options.obs }));
      else if (cmd === 'lote' && action === 'triagem') result = await this.call(`/lots/${encodeURIComponent(this.required(options, 'id'))}/triage`, 'POST');
      else if (cmd === 'lote' && action === 'cancelar') result = await this.call(`/lots/${encodeURIComponent(this.required(options, 'id'))}`, 'DELETE', { motivo: this.required(options, 'motivo') });
      else if (cmd === 'equip' && action === 'criar') {
        const tipo = this.required(options, 'tipo');
        result = await this.call(`/lots/${encodeURIComponent(this.required(options, 'lote'))}/equipment`, 'POST', { id: this.required(options, 'id'), codigoBarrasInterno: `CLI-${tipo}-${randomUUID()}`, tipo, marca: this.required(options, 'marca'), modelo: this.required(options, 'modelo'), anoFabricacao: this.number(options, 'ano'), estadoFisico: this.required(options, 'estado'), pesoQuilogramas: this.number(options, 'peso') });
        success = 'Equipamento cadastrado.';
      } else if (cmd === 'equip' && action === 'listar') result = await this.call(`/equipment${this.query({ loteId: options.lote, status: options.status, incluirCancelados: options.todos === 'true' ? 'true' : undefined })}`);
      else if (cmd === 'equip' && action === 'consultar') {
        const id = options.id ?? await this.findEquipmentId(this.required(options, 'codigo'));
        result = await this.call(`/equipment/${encodeURIComponent(id)}`);
      } else if (cmd === 'equip' && action === 'atualizar') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}`, 'PATCH', this.defined({ marca: options.marca, modelo: options.modelo, anoFabricacao: this.optionalNumber(options.ano), pesoQuilogramas: this.optionalNumber(options.peso) }));
      else if (cmd === 'equip' && action === 'status') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}/status`, 'PATCH', { status: this.required(options, 'status') });
      else if (cmd === 'equip' && action === 'estado') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}/physical-state`, 'PATCH', { estadoFisico: this.required(options, 'estado'), justificativa: options.justificativa });
      else if (cmd === 'equip' && action === 'mover') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}/movements`, 'POST', { destino: this.required(options, 'destino') });
      else if (cmd === 'equip' && action === 'corrigir-movimentacao') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}/movements/corrections`, 'POST', { movimentacaoId: this.required(options, 'mov'), destino: this.required(options, 'destino'), justificativa: this.required(options, 'justificativa') });
      else if (cmd === 'equip' && action === 'estornar-movimentacao') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}/movements/reversals`, 'POST', { movimentacaoId: this.required(options, 'mov'), justificativa: this.required(options, 'justificativa') });
      else if (cmd === 'equip' && action === 'cancelar') result = await this.call(`/equipment/${encodeURIComponent(this.required(options, 'id'))}`, 'DELETE', { motivo: this.required(options, 'motivo') });
      else if (cmd === 'rastrear') result = await this.call(`/equipment/${encodeURIComponent(action)}/tracking`);
      else if (cmd === 'relatorio' && action === 'status') result = await this.call(`/reports/status${this.query({ status: this.required(options, 'status') })}`);
      else if (cmd === 'relatorio' && action === 'organizacao') result = await this.call(`/reports/organizations/${encodeURIComponent(this.required(options, 'org'))}${this.query({ inicio: this.date(options, 'inicio'), fim: this.date(options, 'fim', true) })}`);
      else if (cmd === 'relatorio' && action === 'financeiro') result = await this.call(`/reports/financial${this.query({ inicio: this.date(options, 'inicio'), fim: this.date(options, 'fim', true) })}`);
      else if (cmd === 'relatorio' && action === 'auditoria') result = await this.call(`/reports/audit${this.query({ inicio: this.date(options, 'inicio'), fim: this.date(options, 'fim', true) })}`);
      else throw new Error('Comando inválido ou ainda não suportado. Use ajuda.');

      if (result !== undefined && result !== null) this.show('INFO', JSON.stringify(result, null, 2));
      else this.show('SUCESSO', success);
    } catch (error) {
      this.show('ERRO', error instanceof Error ? error.message : 'Falha na operação.');
    }
  }

  private async call<T = unknown>(path: string, method = 'GET', body?: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authenticated && this.token) headers.authorization = `Bearer ${this.token}`;
    else if (authenticated && !this.token) throw new Error('Faça login primeiro.');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error(`Não foi possível conectar à API em ${this.baseUrl}. Confira se o servidor está iniciado.`);
    }
    const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) {
      const payload = data as { message?: string } | undefined;
      throw new Error(payload?.message ?? `A API respondeu com HTTP ${response.status}.`);
    }
    return data as T;
  }

  private async findCredentialId(username: string): Promise<string> {
    const credentials = await this.call<Array<{ id: string; usuario: string }>>('/auth/credentials');
    const credential = credentials.find((item) => item.usuario === username);
    if (!credential) throw new Error('Usuário não encontrado.');
    return credential.id;
  }

  private async findEquipmentId(barcode: string): Promise<string> {
    const equipment = await this.call<Array<{ id: string; codigoBarrasInterno: string }>>('/equipment');
    const item = equipment.find((entry) => entry.codigoBarrasInterno === barcode);
    if (!item) throw new Error('Equipamento não encontrado.');
    return item.id;
  }

  private query(values: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
  }

  private defined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
  }

  private required(options: Record<string, string>, name: string): string {
    const value = options[name]?.trim();
    if (!value) throw new Error(`O argumento --${name} é obrigatório.`);
    return value;
  }

  private number(options: Record<string, string>, name: string): number {
    const value = Number(this.required(options, name));
    if (!Number.isFinite(value)) throw new Error(`O argumento --${name} deve ser numérico.`);
    return value;
  }

  private optionalNumber(value?: string): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('Valor numérico inválido.');
    return parsed;
  }

  private date(options: Record<string, string>, name: string, endOfDay = false): string {
    const value = this.required(options, name);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`O argumento --${name} deve usar AAAA-MM-DD.`);
    const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`O argumento --${name} contém uma data inválida.`);
    return parsed.toISOString();
  }

  private list(value?: string): string[] | undefined {
    return value?.split('|').map((item) => item.trim()).filter(Boolean);
  }

  private requireSession(): void {
    if (!this.token || !this.usuario) throw new Error('Faça login primeiro.');
  }

  private show(level: string, message: string): void {
    console.log(`[${level}] ${message}`);
  }

  private help(): void {
    this.show('INFO', [
      'API_BASE_URL define o endereço da API (padrão http://127.0.0.1:3000).',
      'login USUARIO --senha SENHA | logout | menu | sair | ajuda',
      'usuario criar/listar/consultar/nome/papel/senha/desativar; senha alterar',
      'parametros consultar/historico/atualizar; org criar/listar/consultar/atualizar/desativar/renovar-contrato/encerrar-contrato',
      'contrato criar/listar/atualizar/cancelar; lote criar/listar/consultar/atualizar/triagem/cancelar',
      'equip criar/listar/consultar/atualizar/status/estado/mover/corrigir-movimentacao/estornar-movimentacao/cancelar; rastrear',
      'relatorio status/organizacao/financeiro/auditoria',
      'Use os argumentos documentados em docs/MANUAL_CLI.md. O acesso é autorizado pela API conforme o papel do usuário.',
    ].join('\n'));
  }
}
