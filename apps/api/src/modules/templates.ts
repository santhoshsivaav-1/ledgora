import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import { idParam, okBody, templateInput, termsTemplate } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { notFound } from '../errors.ts';
import { stamps, type Registrar } from '../http.ts';

const { termsTemplates } = schema;
const out = (r: typeof termsTemplates.$inferSelect) => ({
  id: r.id,
  name: r.name,
  content: r.content,
  isDefault: r.isDefault,
  ...stamps(r),
});

export function templatesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/templates',
    tag: 'Terms',
    summary: 'Terms and conditions templates',
    response: z.object({ data: z.array(termsTemplate) }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(termsTemplates)
        .where(isNull(termsTemplates.deletedAt))
        .orderBy(termsTemplates.name);
      return { data: rows.map(out) };
    },
  });

  route({
    method: 'post',
    path: '/v1/templates',
    tag: 'Terms',
    summary: 'Create a template',
    body: templateInput,
    response: termsTemplate,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [row] = await tx
        .insert(termsTemplates)
        .values({ ...body, orgId })
        .returning();
      if (row.isDefault)
        await tx
          .update(termsTemplates)
          .set({ isDefault: false })
          .where(and(ne(termsTemplates.id, row.id), isNull(termsTemplates.deletedAt)));
      await audit(tx, orgId, 'template.create', 'template', row.id);
      return out(row);
    },
  });

  route({
    method: 'put',
    path: '/v1/templates/:id',
    tag: 'Terms',
    summary: 'Replace a template',
    params: idParam,
    body: templateInput,
    response: termsTemplate,
    handler: async ({ tx, orgId, params, body }) => {
      const [row] = await tx
        .update(termsTemplates)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(termsTemplates.id, params.id), isNull(termsTemplates.deletedAt)))
        .returning();
      if (!row) throw notFound('Template');
      if (row.isDefault)
        await tx
          .update(termsTemplates)
          .set({ isDefault: false })
          .where(and(ne(termsTemplates.id, row.id), isNull(termsTemplates.deletedAt)));
      await audit(tx, orgId, 'template.update', 'template', row.id);
      return out(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/templates/:id',
    tag: 'Terms',
    summary: 'Move a template to the trash',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(termsTemplates)
        .set({ deletedAt: new Date() })
        .where(and(eq(termsTemplates.id, params.id), isNull(termsTemplates.deletedAt)))
        .returning();
      if (!row) throw notFound('Template');
      await audit(tx, orgId, 'template.delete', 'template', row.id);
      return { ok: true };
    },
  });
}
