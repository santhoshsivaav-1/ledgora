import { and, eq, isNull, asc, desc } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import { onboardingInput, onboardingStatus, type OnboardingStatus } from '@ledgora/contracts';
import { INDIAN_STATES, getStateCode } from '@ledgora/tax-engine';
import { audit } from '../../audit.ts';
import { AppError } from '../../errors.ts';
import type { Registrar } from '../../http.ts';

const { businesses, organizations } = schema;

const toStatus = (b: typeof businesses.$inferSelect): OnboardingStatus => ({
  // A new account's business has no state until the first-run form is saved.
  complete: b.state.trim() !== '',
  business: {
    id: b.id,
    name: b.name,
    gstin: b.gstin,
    state: b.state,
    address: b.address,
    city: b.city,
    pin: b.pin,
    phone: b.phone,
    email: b.email,
  },
});

/** The first-run form that follows sign-up: names the business and sets its state, GSTIN and address. */
export function onboardingModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/onboarding',
    tag: 'Onboarding',
    summary: 'Has the first-run business form been filled in, and what is saved so far',
    response: onboardingStatus,
    handler: async ({ tx }) => {
      const [b] = await tx
        .select()
        .from(businesses)
        .where(isNull(businesses.deletedAt))
        .orderBy(desc(businesses.isDefault), asc(businesses.createdAt))
        .limit(1);
      if (!b) throw new AppError('not_found', 'This organization has no business yet');
      return toStatus(b);
    },
  });

  route({
    method: 'post',
    path: '/v1/onboarding/business',
    tag: 'Onboarding',
    summary: 'Save the first-run business details (checks the GSTIN belongs to the chosen state)',
    body: onboardingInput,
    response: onboardingStatus,
    handler: async ({ tx, orgId, body, deps }) => {
      if (!(INDIAN_STATES as readonly string[]).includes(body.state))
        throw new AppError('validation_failed', 'Choose a state from the list', [
          { path: 'state', message: 'Unknown state' },
        ]);
      if (body.gstin && getStateCode(body.gstin) !== getStateCode(body.state)) {
        throw new AppError(
          'validation_failed',
          'The GSTIN does not belong to the state you chose',
          [
            {
              path: 'gstin',
              message: `Starts with ${body.gstin.slice(0, 2)}, which is not the code for ${body.state}`,
            },
          ],
        );
      }
      const [current] = await tx
        .select()
        .from(businesses)
        .where(and(isNull(businesses.deletedAt), eq(businesses.isDefault, true)))
        .limit(1);
      if (!current) throw new AppError('not_found', 'This organization has no business yet');
      const [row] = await tx
        .update(businesses)
        .set({ ...body, gstin: body.gstin || null, updatedAt: new Date() })
        .where(eq(businesses.id, current.id))
        .returning();
      // The organization is named after its first business until someone renames it on purpose.
      await deps.db
        .update(organizations)
        .set({ name: row.name, updatedAt: new Date() })
        .where(and(eq(organizations.id, orgId), eq(organizations.name, current.name)));
      await audit(tx, orgId, 'onboarding.business', 'business', row.id, {
        before: { name: current.name, state: current.state },
        after: { name: row.name, state: row.state, gstin: row.gstin },
      });
      return toStatus(row);
    },
  });
}
