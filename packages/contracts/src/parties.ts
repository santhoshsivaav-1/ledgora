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
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type PartyInput = z.infer<typeof partyInput>;
export const partyPatch = patchOf(partyInput);
export const party = partyInput.extend({ id: uuid, ...withStamps });
export type Party = z.infer<typeof party>;
export const partyListQuery = z.object({ kind: z.enum(PARTY_KINDS).optional() });
