export type EnvironmentSecretReference = {
  readonly provider: 'environment';
  readonly key: string;
  readonly version?: string;
};

export interface EnvironmentSecretResolverOptions {
  readonly values?: Readonly<Record<string, string | undefined>>;
}

export class EnvironmentSecretResolutionError extends Error {
  public readonly secretKey: string;

  public constructor(secretKey: string, message?: string) {
    super(message ?? `Environment secret "${secretKey}" is not set.`);
    this.name = 'EnvironmentSecretResolutionError';
    this.secretKey = secretKey;
  }
}

export class EnvironmentSecretResolver {
  private readonly values: Readonly<Record<string, string | undefined>>;

  public constructor(options: EnvironmentSecretResolverOptions = {}) {
    this.values = options.values ?? process.env;
  }

  public canResolve(reference: {
    readonly provider: string;
    readonly key: string;
  }): reference is EnvironmentSecretReference {
    return reference.provider === 'environment';
  }

  public resolve(reference: EnvironmentSecretReference): string {
    const resolvedValue = this.values[reference.key];

    if (typeof resolvedValue !== 'string' || resolvedValue.length === 0) {
      throw new EnvironmentSecretResolutionError(reference.key);
    }

    return resolvedValue;
  }
}
