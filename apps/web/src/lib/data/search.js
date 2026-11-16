// Open Anything: the invoices, parties and items matching what was typed. The server does the matching (at most 8 of each), so
// the browser never downloads whole collections to search them.

import { apiClient } from '../apiClient';

export const searchWorkspace = (q, signal) =>
  apiClient.get('/v1/workspace/search', { query: { q }, signal });

/** What the bell shows, worked out on the server: overdue and soon-due invoices, low-stock candidates, the auto-fire note. */
export const notificationSummary = (today, soon = 3) =>
  apiClient.get('/v1/workspace/notifications', { query: { today, soon } });
