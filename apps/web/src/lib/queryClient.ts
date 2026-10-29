import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiClient';

/**
 * One cache for server data (change 3.3). A failed request is retried only when retrying can help: a 4xx answer
 * (wrong input, no access, expired session) will not change on the second try.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}

/** Query keys in one place, so a screen that changes invoices can refresh every list that shows them. */
export const keys = {
  me: ['me'] as const,
  members: ['members'] as const,
  invitations: ['invitations'] as const,
  sessions: ['sessions'] as const,
  audit: ['audit'] as const,
  parties: (q?: unknown) => ['parties', q ?? null] as const,
  items: (q?: unknown) => ['items', q ?? null] as const,
  invoices: (q?: unknown) => ['invoices', q ?? null] as const,
};
