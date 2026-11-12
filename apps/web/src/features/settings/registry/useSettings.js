import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTINGS } from '@ledgora/contracts';
import { apiClient } from '../../../lib/apiClient';
import { setAppSettings } from '../../../lib/appSettings';

// Vyapar parity P8-S1: `useSettings(businessId)` reads every setting with defaults merged; `set(key, value)` updates the
// screen at once and puts the old value back if the API refuses (owner-only, invalid, or the server is down).
// The older reader of these values (/v1/businesses/:id/settings and the screens built on it) is untouched.

const keyOf = (businessId) => ['settings', businessId];

export function useSettings(businessId) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keyOf(businessId),
    enabled: !!businessId,
    queryFn: async () => (await apiClient.get(`/v1/settings?businessId=${businessId}`)).settings,
  });
  const mutation = useMutation({
    mutationFn: async ({ key, value }) =>
      (await apiClient.patch('/v1/settings', { businessId, values: { [key]: value } }, { quietForbidden: true })).settings,
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: keyOf(businessId) });
      const previous = qc.getQueryData(keyOf(businessId));
      qc.setQueryData(keyOf(businessId), (old) => ({ ...old, [key]: value }));
      return { previous };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(keyOf(businessId), ctx?.previous),
    onSuccess: (settings) => {
      qc.setQueryData(keyOf(businessId), settings);
      setAppSettings(businessId, settings);
    },
  });
  return {
    settings: query.data,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    saving: mutation.isPending,
    set: (key, value) => mutation.mutateAsync({ key, value }),
  };
}

/** One setting, for a screen that obeys it: `const [mode] = useSetting(businessId, 'txn.negativeStock')`. */
export function useSetting(businessId, key) {
  const { settings, set } = useSettings(businessId);
  return [settings ? settings[key] : SETTINGS[key].default, (v) => set(key, v)];
}
