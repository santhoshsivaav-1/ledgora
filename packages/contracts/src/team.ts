import { z } from 'zod';
import { uuid } from './common.ts';
import { role } from './permissions.ts';

export const me = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phoneNumber: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
  }),
  organization: z.object({ id: uuid, name: z.string() }),
  role,
  permissions: z.array(z.string()),
  businessIds: z.array(uuid).nullable(), // null = every business
  organizations: z.array(z.object({ id: uuid, name: z.string(), role })),
  subscription: z
    .object({ plan: z.string(), status: z.string(), trialEndsAt: z.string().nullable() })
    .nullable(),
});
export type Me = z.infer<typeof me>;

export const member = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  phoneNumber: z.string().nullable(),
  role,
  businessIds: z.array(uuid).nullable(),
  joinedAt: z.string(),
});
export const memberPatch = z.object({
  role: role.optional(),
  businessIds: z.array(uuid).nullable().optional(),
});

export const invitationInput = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+\d{8,15}$/, 'Use international format, e.g. +919876543210')
      .optional(),
    role: role.exclude(['owner']),
    businessIds: z.array(uuid).default([]),
  })
  .refine((v) => v.email || v.phone, 'Give an e-mail or a phone number');
export const invitation = z.object({
  id: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role,
  businessIds: z.array(uuid),
  status: z.enum(['pending', 'accepted', 'revoked']),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const sessionRow = z.object({
  id: z.string(),
  current: z.boolean(),
  device: z.string(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const auditRow = z.object({
  id: uuid,
  at: z.string(),
  actorId: z.string().nullable(),
  ip: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});

/** The first-run form: the details of the business the account was created with. */
export const onboardingInput = z.object({
  name: z.string().trim().min(1, 'Enter your business name').max(200),
  gstin: z
    .union([
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Not a valid GSTIN'),
      z.literal(''),
    ])
    .default(''),
  state: z.string().trim().min(1, 'Choose your state'),
  address: z.string().trim().max(500).default(''),
  city: z.string().trim().max(100).default(''),
  pin: z.string().trim().max(10).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.string().trim().max(200).default(''),
});
export type OnboardingInput = z.infer<typeof onboardingInput>;
export const onboardingStatus = z.object({
  complete: z.boolean(),
  business: z.object({
    id: uuid,
    name: z.string(),
    gstin: z.string().nullable(),
    state: z.string(),
    address: z.string(),
    city: z.string(),
    pin: z.string(),
    phone: z.string(),
    email: z.string(),
  }),
});
export type OnboardingStatus = z.infer<typeof onboardingStatus>;
