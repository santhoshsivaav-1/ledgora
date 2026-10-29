import { createContext, useContext } from 'react';
import type { Me } from '@ledgora/contracts';

export interface SessionValue {
  /** The signed-in user, organization, role and plan. null only outside the sign-in gate. */
  me: Me | null;
  signOut: () => Promise<void>;
  /** Ask the server again who we are (after joining an organization, turning on two-step sign-in, ...). */
  refresh: () => Promise<void>;
}

// Who is signed in, for the parts of the app that show it (the sidebar), check it (permissions) or end it (Log out).
export const SessionContext = createContext<SessionValue>({ me: null, signOut: async () => {}, refresh: async () => {} });
export const useSession = () => useContext(SessionContext);
