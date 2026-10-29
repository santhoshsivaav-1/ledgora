import { z } from 'zod';
import type { DocumentedRoute } from './http.ts';

const toSchema = (s: z.ZodType, io: 'input' | 'output') => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, {
    io,
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
  return rest;
};

function parameters(schema: z.ZodType | undefined, where: 'path' | 'query') {
  if (!schema) return [];
  const json = toSchema(schema, 'input') as {
    properties?: Record<string, object>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, sch]) => ({
    name,
    in: where,
    required: where === 'path' || (json.required ?? []).includes(name),
    schema: sch,
  }));
}

/** OpenAPI 3.1 document built from the same Zod schemas the routes validate with, so the two can not drift (change 1.26). */
export function buildOpenApi(routes: DocumentedRoute[], version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorRef = {
    description: 'Error',
    content: { 'application/json': { schema: toSchema(errorBodySchema, 'output') } },
  };
  for (const r of routes) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      parameters: [...parameters(r.params, 'path'), ...parameters(r.query, 'query')],
      responses: {
        [String(r.status)]: {
          description: 'Success',
          content: r.response
            ? { 'application/json': { schema: toSchema(r.response, 'output') } }
            : undefined,
        },
        '400': errorRef,
        '404': errorRef,
        '409': errorRef,
      },
    };
    if (r.body)
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: toSchema(r.body, 'input') } },
      };
    (paths[path] ??= {})[r.method] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ledgora API',
      version,
      description:
        'Multi-tenant GST billing API. Sign in with POST /v1/auth/sign-in/email (or a phone OTP) and the browser keeps the session cookie; /v1/console is a small page that does this for you. ' +
        'Errors always look like `{ "error": { "code", "message", "details?" } }`. Lists use cursor pagination: pass `nextCursor` back as `cursor`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'Session cookie set when you sign in. In Swagger UI, sign in on /v1/console first: the browser then sends the cookie for you.',
        },
      },
    },
    security: [{ session: [] }],
    paths,
  };
}

import { errorBody as errorBodySchema } from '@ledgora/contracts';

export const docsHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Ledgora API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/v1/openapi.json', dom_id: '#ui', deepLinking: true });</script>
</body></html>`;
