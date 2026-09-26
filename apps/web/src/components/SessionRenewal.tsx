'use client';

import { useSessionRenewal } from '@/hooks/useSessionRenewal';

export function SessionRenewal() {
  useSessionRenewal();
  return null;
}
