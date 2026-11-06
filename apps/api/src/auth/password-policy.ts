/** Senhas que o bootstrap usa quando BOOTSTRAP_*_PASSWORD não está no ambiente. */
export const BOOTSTRAP_DEFAULT_PASSWORDS = [
  'ChangeMe!Admin2026',
  'ChangeMe!Fiscal01_2026',
  'ChangeMe!Fiscal02_2026',
  'ChangeMe!Operator2026',
] as const;

export class DefaultPasswordRejectedError extends Error {
  readonly code = 'default_password_rejected';

  constructor() {
    super('Senha padrão do bootstrap não é aceita fora do ambiente de desenvolvimento.');
    this.name = 'DefaultPasswordRejectedError';
  }
}

export function isBootstrapDefaultPassword(password: string): boolean {
  return (BOOTSTRAP_DEFAULT_PASSWORDS as readonly string[]).includes(password);
}

/**
 * Fora de development/test, a senha padrão não abre sessão.
 * Em development/test ela abre, mas o usuário continua obrigado a trocá-la.
 */
export function evaluateLoginPassword(input: {
  nodeEnv: string;
  password: string;
  mustChangePassword: boolean;
}): { mustChangePassword: boolean } {
  const usingDefault = isBootstrapDefaultPassword(input.password);
  if (usingDefault && input.nodeEnv === 'production') {
    throw new DefaultPasswordRejectedError();
  }
  return {
    mustChangePassword: input.mustChangePassword || usingDefault,
  };
}

/**
 * Usuário novo do bootstrap sempre nasce com troca obrigatória.
 * Em produção a senha precisa vir do ambiente e não pode ser a padrão.
 */
export function resolveBootstrapPassword(input: {
  nodeEnv: string;
  envPassword: string | undefined;
  defaultPassword: string;
}): { password: string } {
  const provided = input.envPassword?.trim() ?? '';
  const password = provided.length > 0 ? provided : input.defaultPassword;
  if (input.nodeEnv === 'production' && isBootstrapDefaultPassword(password)) {
    throw new Error(
      'Em produção defina BOOTSTRAP_*_PASSWORD com uma senha que não seja a padrão do bootstrap.'
    );
  }
  return { password };
}
