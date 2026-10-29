import { createContext, useContext } from 'react';

// Who is signed in, for the parts of the app that show it (the sidebar) or end it (Log out).
export const SessionContext = createContext({ me: null, signOut: async () => {}, refresh: async () => {} });
export const useSession = () => useContext(SessionContext);
