// The active business profile and the saved business profiles.

import { API, apiFetch } from './api';

// ---- Profile ----
// Nearly every screen reads the profile on open. One shared read (and a 30 s copy) instead of one request per screen;
// saving drops the copy so the next read is fresh.
let profileRead = null;
let profileAt = 0;
export const saveProfile = async (profile) => {
  profileRead = null;
  return apiFetch(`${API}/profile`, { method: 'POST', body: JSON.stringify(profile) });
};

export const getProfile = async () => {
  if (!profileRead || Date.now() - profileAt > 30000) {
    profileAt = Date.now();
    profileRead = apiFetch(`${API}/profile`).catch((e) => { profileRead = null; throw e; });
  }
  return { ...(await profileRead) };
};


// ---- Business Profiles (multi-business) ----
export const getAllProfiles = async () => {
  return apiFetch(`${API}/collections/profiles`);
};

export const saveBusinessProfile = async (profile) => {
  const res = await apiFetch(`${API}/collections/profiles`, { method: 'POST', body: JSON.stringify(profile) });
  if (res.id) profile.id = res.id;
  return profile;
};

export const deleteBusinessProfile = async (id) => {
  return apiFetch(`${API}/collections/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
