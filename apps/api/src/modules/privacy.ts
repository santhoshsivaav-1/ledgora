// Data-protection requests and consent (India's DPDP Act, 2023): a person records that they accepted the terms and privacy policy,
// and can ask for their data to be accessed, corrected or erased. Each is written to the audit log; a request is also mailed to
// SUPPORT_EMAIL (when set) and acknowledged to the person.
import { z } from 'zod';
import { audit } from '../audit.ts';
import { sendMail } from '../mail/index.ts';
import { dataRequestMail, dataRequestReceivedMail } from '../mail/templates.ts';
import type { Registrar } from '../http.ts';

export function privacyModule({ route }: Registrar) {
  route({
    method: 'post',
    path: '/v1/privacy/consent',
    tag: 'Privacy',
    summary:
      'Record that the signed-in person accepted a version of the terms and the privacy policy',
    permission: null,
    body: z.object({ version: z.string().trim().min(4).max(40) }),
    handler: async ({ tx, orgId, auth, body }) => {
      await audit(tx, orgId, 'consent.accepted', 'user', auth.user.id, {
        after: { version: body.version },
      });
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/privacy/requests',
    tag: 'Privacy',
    summary: 'Ask to see, correct or erase your personal data',
    permission: null,
    body: z.object({
      kind: z.enum(['access', 'correction', 'erasure']),
      note: z.string().trim().max(2000).default(''),
    }),
    handler: async ({ tx, orgId, auth, body, deps }) => {
      await audit(tx, orgId, 'privacy.request', 'user', auth.user.id, {
        after: { kind: body.kind },
      });
      if (deps.env.SUPPORT_EMAIL)
        await sendMail(
          deps.env,
          dataRequestMail(
            deps.env.SUPPORT_EMAIL,
            `${auth.user.name} <${auth.user.email}>`,
            body.kind,
            body.note,
            orgId,
          ),
        );
      await sendMail(deps.env, dataRequestReceivedMail(auth.user.email, auth.user.name, body.kind));
      return { ok: true };
    },
  });
}
