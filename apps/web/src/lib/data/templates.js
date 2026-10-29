// Terms and conditions templates.

import { API, apiFetch } from './api';

// ---- Terms Templates ----
export const getTermsTemplates = async () => {
  return apiFetch(`${API}/collections/templates`);
};

export const saveTermsTemplate = async (template) => {
  const res = await apiFetch(`${API}/collections/templates`, { method: 'POST', body: JSON.stringify(template) });
  if (res.id) template.id = res.id;
  return template;
};

export const deleteTermsTemplate = async (id) => {
  return apiFetch(`${API}/collections/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
