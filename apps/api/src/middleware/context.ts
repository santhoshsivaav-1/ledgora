import type { Role } from '@ledgora/contracts';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  emailVerified: boolean;
  phoneNumberVerified: boolean;
  twoFactorEnabled: boolean;
}

/** Who is calling, after the middleware chain. Handlers receive this as `auth`. */
export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  activeOrganizationId: string | null;
  ip: string | null;
}

export interface OrgContext extends AuthContext {
  orgId: string;
  memberId: string;
  role: Role;
  /** null = every business of the organization. */
  businessIds: string[] | null;
  /** P7-S6: a member (a CA) limited to reports for these dates. null = no limit. */
  dataFrom: string | null;
  dataTo: string | null;
  /** Account Access: only the documents this member made (set by the permission check). */
  ownOnly?: boolean;
  /** Account Access: never shown purchase prices. */
  hideCost?: boolean;
}
