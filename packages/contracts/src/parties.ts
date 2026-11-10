import { z } from 'zod';
import { optionalGstin, patchOf, uuid, withStamps } from './common.ts';

export const PARTY_KINDS = ['customer', 'supplier', 'both'] as const;

export const partyInput = z.object({
  kind: z.enum(PARTY_KINDS).default('customer'),
  name: z.string().trim().min(1).max(200),
  gstin: optionalGstin,
  pan: z.string().trim().max(10).nullish(),
  address: z.string().max(500).default(''),
  city: z.string().max(100).default(''),
  pin: z.string().max(10).default(''),
  state: z.string().max(100).default(''),
  country: z.string().max(100).default('India'),
  email: z.string().max(200).default(''),
  phone: z.string().max(30).default(''),
  isSez: z.boolean().default(false),
  openingBalance: z.number().default(0),
  /** The party's group (P1-S1); null or left out = no group. */
  groupId: uuid.nullish(),
  /** P2-S4 credit limit. null = no limit; `warn` asks before an invoice goes over it, `block` refuses it. */
  creditLimit: z.number().min(0).nullish(),
  creditMode: z.enum(['none', 'warn', 'block']).default('none'),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type PartyInput = z.infer<typeof partyInput>;
export const partyPatch = patchOf(partyInput);
export const party = partyInput.extend({ id: uuid, ...withStamps });
export type Party = z.infer<typeof party>;
export const partyListQuery = z.object({
  kind: z.enum(PARTY_KINDS).optional(),
  /** Parties in this group or any group below it. */
  groupId: uuid.optional(),
});

// ---- Party groups (Vyapar parity P1-S1) ----------------------------------------------------------------------------

/** A named bucket of parties ("Wholesale", "Retail > Chennai"). Names are unique per organization, ignoring case. */
export const partyGroupInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: uuid.nullish(),
});
export type PartyGroupInput = z.infer<typeof partyGroupInput>;
export const partyGroupPatch = patchOf(partyGroupInput);
export const partyGroup = partyGroupInput.extend({
  id: uuid,
  /** Live parties directly in this group (not its children). */
  partyCount: z.number().int().optional(),
  ...withStamps,
});
export type PartyGroup = z.infer<typeof partyGroup>;
/** DELETE with `moveTo` moves the group's parties (and child groups) there first; without it a used group is refused. */
export const partyGroupDeleteQuery = z.object({ moveTo: uuid.optional() });
