import { resolveStellarNetwork, StellarNetworkConfigurationError } from '@/lib/auth/stellarAuth';

const PASSPHRASE_ENV_VAR = 'STELLAR_NETWORK_PASSPHRASE';

export function getServerStellarNetworkPassphrase(): string {
  const passphrase = process.env[PASSPHRASE_ENV_VAR]?.trim();
  if (!passphrase) {
    throw new StellarNetworkConfigurationError(`${PASSPHRASE_ENV_VAR} is not configured`);
  }

  try {
    return resolveStellarNetwork({ passphrase }).passphrase;
  } catch (error) {
    if (!(error instanceof StellarNetworkConfigurationError)) throw error;
    throw new StellarNetworkConfigurationError(
      `${PASSPHRASE_ENV_VAR} is invalid: ${error.message}`,
    );
  }
}
