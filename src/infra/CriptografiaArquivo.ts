import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CriptografiaArquivo {
  cifrar(dados: string, chave: string): string {
    const chaveBuffer = this.obterChave(chave);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', chaveBuffer, iv);
    const dadosCifrados = Buffer.concat([cipher.update(dados, 'utf-8'), cipher.final()]);
    const tagAutenticacao = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      tagAutenticacao.toString('base64'),
      dadosCifrados.toString('base64'),
    ].join('.');
  }

  decifrar(dadosCifrados: string, chave: string): string {
    const partes = dadosCifrados.split('.');

    if (partes.length !== 3) {
      throw new Error('Dados cifrados em formato inválido.');
    }

    const [ivCodificado, tagCodificada, conteudoCodificado] = partes;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.obterChave(chave),
      Buffer.from(ivCodificado, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(tagCodificada, 'base64'));

    try {
      const dadosDecifrados = Buffer.concat([
        decipher.update(Buffer.from(conteudoCodificado, 'base64')),
        decipher.final(),
      ]);

      return dadosDecifrados.toString('utf-8');
    } catch {
      throw new Error('Não foi possível decifrar os dados: chave inválida ou conteúdo alterado.');
    }
  }

  gerarChave(): string {
    return randomBytes(32).toString('hex');
  }

  private obterChave(chave: string): Buffer {
    if (!/^[a-fA-F0-9]{64}$/.test(chave)) {
      throw new Error('A chave de criptografia deve possuir 32 bytes em hexadecimal.');
    }

    return Buffer.from(chave, 'hex');
  }
}
