export type ServiceHealth = 'operational' | 'degraded' | 'unavailable' | 'unknown';

export interface SystemHealth {
  checkedAt: string;
  services: {
    rpc: ServiceHealth;
    indexer: ServiceHealth;
    relayer: ServiceHealth;
  };
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const response = await fetch('/api/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return response.json() as Promise<SystemHealth>;
}

export function overallHealth(services: SystemHealth['services']): ServiceHealth {
  const values = Object.values(services);
  if (values.some((status) => status === 'unavailable')) return 'unavailable';
  if (values.some((status) => status === 'degraded')) return 'degraded';
  if (values.every((status) => status === 'operational')) return 'operational';
  return 'unknown';
}
