// Vyapar parity P7-S4: Backup, restore and the schedule. A backup is a snapshot file of the organization (see
// backup/snapshot.ts): optionally password-encrypted, stored, listed here and downloadable. Restore is owner-only,
// asks for the word RESTORE, takes a safety snapshot first, and runs in one transaction, so a bad file or a failure
// leaves nothing half-written. It adds to an organization that has no business data yet; it never deletes.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withTenant } from '@ledgora/db';
import {
  backupCreateInput,
  backupOut,
  backupSettingsDto,
  idParam,
  okBody,
  restoreInput,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { runBackupIfDue } from '../backup/scheduler.ts';
import {
  authUrl as driveAuthUrl,
  driveAvailable,
  exchangeCode as driveExchange,
  revoke as revokeAccess,
} from '../backup/drive.ts';
import { openText, readState, sealText, signState } from '../backup/keys.ts';
import { reminderDue } from '../backup/schedule.ts';
import { snapshotIsEncrypted } from '../backup/snapshot.ts';
import {
  prune,
  readBackupBytes,
  storedPassword,
  removeBackup,
  restoreSnapshotFile,
  takeBackup,
} from '../backup/store.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';

const { backups, backupSettings, backupDrive } = schema;

const toOut = (b: typeof backups.$inferSelect) => ({
  id: b.id,
  kind: b.kind as 'manual' | 'auto' | 'safety',
  fileName: b.fileName,
  sizeBytes: b.sizeBytes,
  encrypted: b.encrypted,
  keyMode: b.keyMode as 'none' | 'password' | 'server',
  onDrive: !!b.driveFileId,
  schemaVersion: b.schemaVersion,
  counts: b.counts as Record<string, number>,
  createdAt: b.createdAt.toISOString(),
  note: b.note,
});
const DEFAULT_SETTINGS = {
  frequency: 'off' as const,
  hour: 21,
  keepLast: 7,
  remind: true,
  remindDays: 7,
};

export function backupsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/backups',
    tag: 'Backup',
    summary: 'Backup history, the schedule and whether a reminder is due',
    handler: async ({ tx, deps }) => {
      const [dr] = await tx.select().from(backupDrive).where(isNull(backupDrive.deletedAt));
      const rows = await tx
        .select()
        .from(backups)
        .where(isNull(backups.deletedAt))
        .orderBy(desc(backups.createdAt))
        .limit(100);
      const [s] = await tx.select().from(backupSettings);
      const settings = s
        ? {
            frequency: s.frequency as 'off' | 'daily' | 'weekly',
            hour: s.hour,
            keepLast: s.keepLast,
            remind: s.remind,
            remindDays: s.remindDays,
          }
        : DEFAULT_SETTINGS;
      const last = rows.find((r) => r.kind !== 'safety');
      return {
        data: rows.map(toOut),
        settings,
        lastBackupAt: last?.createdAt.toISOString() ?? null,
        lastRunAt: s?.lastRunAt?.toISOString() ?? null,
        lastError: s?.lastError ?? null,
        drive: {
          available: driveAvailable(deps.env),
          connected: !!dr,
          email: dr?.email ?? '',
          lastError: dr?.lastError ?? null,
        },
        reminderDue: reminderDue({
          remind: settings.remind,
          remindDays: settings.remindDays,
          lastBackupAt: last?.createdAt.toISOString() ?? null,
          now: new Date(),
        }),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/backups',
    tag: 'Backup',
    summary:
      'Back up now: a snapshot of every business in the organization, optionally encrypted with a password',
    body: backupCreateInput,
    response: backupOut,
    status: 201,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      const { row, driveError } = await takeBackup(tx, orgId, deps, {
        kind: 'manual',
        password: body.password,
        note: body.note,
        userId: auth.user.id,
        toDrive: body.toDrive,
      });
      await audit(tx, orgId, 'backup.create', 'backup', row.id, {
        after: { encrypted: row.encrypted, sizeBytes: row.sizeBytes, drive: !!row.driveFileId },
      });
      return { ...toOut(row), driveError };
    },
  });

  route({
    method: 'get',
    path: '/v1/backups/:id/download',
    tag: 'Backup',
    summary: 'The .ledgora file',
    params: idParam,
    handler: async ({ tx, orgId, params, deps }) => {
      const [b] = await tx
        .select()
        .from(backups)
        .where(and(eq(backups.id, params.id), isNull(backups.deletedAt)));
      if (!b) throw notFound('Backup');
      const bytes = await readBackupBytes(tx, deps, b);
      await audit(tx, orgId, 'backup.download', 'backup', b.id);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${b.fileName}"`,
        },
      });
    },
  });

  route({
    method: 'delete',
    path: '/v1/backups/:id',
    tag: 'Backup',
    summary: 'Delete a backup from the history and storage',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params, deps }) => {
      const [b] = await tx.select().from(backups).where(eq(backups.id, params.id));
      if (!b) throw notFound('Backup');
      await removeBackup(tx, deps, b);
      await audit(tx, orgId, 'backup.delete', 'backup', b.id);
      return { ok: true };
    },
  });

  route({
    method: 'put',
    path: '/v1/backups/settings',
    tag: 'Backup',
    summary: 'The auto-backup schedule, how many to keep, and the reminder',
    body: backupSettingsDto,
    response: backupSettingsDto,
    handler: async ({ tx, orgId, body, deps }) => {
      await tx
        .insert(backupSettings)
        .values({ orgId, ...body })
        .onConflictDoUpdate({
          target: backupSettings.orgId,
          set: { ...body, updatedAt: new Date() },
        })
        .catch(async () => {
          const [s] = await tx.select().from(backupSettings);
          if (s)
            await tx
              .update(backupSettings)
              .set({ ...body, updatedAt: new Date() })
              .where(eq(backupSettings.id, s.id));
        });
      await prune(tx, deps, 'auto', body.keepLast);
      await audit(tx, orgId, 'backup.settings', 'backup', null, { after: body });
      return body;
    },
  });

  route({
    method: 'post',
    path: '/v1/backups/run-due',
    tag: 'Backup',
    summary:
      "Take this organization's scheduled backup now if it is due (the scheduler calls the same function)",
    response: z.object({ taken: z.boolean() }),
    handler: async ({ tx, orgId, deps }) => ({ taken: await runBackupIfDue(tx, orgId, deps) }),
  });

  route({
    method: 'post',
    path: '/v1/backups/restore',
    tag: 'Backup',
    summary:
      'Restore a backup file (or one from the history). Without confirm RESTORE it only previews what is in it. Owner only; a safety snapshot is taken first; one transaction, nothing is written if anything fails',
    body: restoreInput,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      if (auth.role !== 'owner')
        throw new AppError('forbidden', 'Only the owner can restore a backup');
      let bytes: Buffer;
      let password = body.password;
      if (body.backupId) {
        const [b] = await tx
          .select()
          .from(backups)
          .where(and(eq(backups.id, body.backupId), isNull(backups.deletedAt)));
        if (!b) throw notFound('Backup');
        bytes = await readBackupBytes(tx, deps, b);
        // A scheduled backup is encrypted with a key only this server holds, so it opens from the history without a password.
        password ??= storedPassword(deps, orgId, b);
      } else if (body.file) bytes = Buffer.from(body.file, 'base64');
      else
        throw new AppError('bad_request', 'Send the backup file or the id of one in the history');
      let encrypted = false;
      try {
        encrypted = snapshotIsEncrypted(bytes);
      } catch {
        throw new AppError('unprocessable', 'This is not a Ledgora backup file', {
          reason: 'bad_format',
        });
      }
      if (body.confirm && body.confirm !== 'RESTORE')
        throw new AppError('unprocessable', 'Type RESTORE to confirm');
      const r = await restoreSnapshotFile(tx, orgId, deps, {
        bytes,
        password,
        userId: auth.user.id,
        orgName: '',
        confirm: body.confirm === 'RESTORE',
      });
      return { ...r, encrypted };
    },
  });
  // ---- Google Drive (P7-S4) ----
  route({
    method: 'get',
    path: '/v1/backups/drive/connect',
    tag: 'Backup',
    summary:
      'Where to send the owner to allow Ledgora to save backups to their Google Drive (drive.file scope: only files Ledgora makes)',
    handler: async ({ orgId, auth, deps }) => {
      if (!driveAvailable(deps.env))
        throw new AppError(
          'conflict',
          'Google Drive is not set up on this server (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)',
        );
      const state = signState(deps.env, { orgId, userId: auth.user.id });
      return { url: driveAuthUrl(deps.env, state) };
    },
  });

  route({
    method: 'get',
    path: '/v1/backups/drive/callback',
    tag: 'Backup',
    summary:
      'Google sends the owner back here with a code; it is exchanged for long-term access and stored encrypted',
    access: 'public',
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
    handler: async ({ query, deps }) => {
      const back = (r: string) =>
        new Response(null, {
          status: 302,
          headers: {
            location: `${deps.env.APP_URL.replace(/\/$/, '')}/utilities/backup?drive=${r}`,
          },
        });
      const st = query.state ? readState(deps.env, query.state) : null;
      if (!st || query.error || !query.code || typeof st.orgId !== 'string') return back('denied');
      try {
        const t = await driveExchange(deps.env, query.code);
        await withTenant(
          deps.db,
          st.orgId,
          async (tx) => {
            const sealed = sealText(deps.env, t.refreshToken);
            const [have] = await tx.select().from(backupDrive);
            if (have)
              await tx
                .update(backupDrive)
                .set({
                  refreshTokenEnc: sealed,
                  email: t.email,
                  folderId: null,
                  lastError: null,
                  deletedAt: null,
                  updatedAt: new Date(),
                })
                .where(eq(backupDrive.id, have.id));
            else
              await tx
                .insert(backupDrive)
                .values({ orgId: st.orgId as string, refreshTokenEnc: sealed, email: t.email });
            await audit(tx, st.orgId as string, 'backup.drive.connect', 'backup', null, {
              after: { email: t.email },
            });
          },
          { actorId: String(st.userId ?? '') },
        );
        return back('connected');
      } catch {
        return back('error');
      }
    },
  });

  route({
    method: 'delete',
    path: '/v1/backups/drive/connection',
    tag: 'Backup',
    summary:
      'Disconnect Google Drive: the stored access is deleted and revoked. Copies already on Drive stay there',
    response: okBody,
    handler: async ({ tx, orgId, deps }) => {
      const [d] = await tx.select().from(backupDrive);
      if (d) {
        await revokeAccess(openText(deps.env, d.refreshTokenEnc));
        await tx.delete(backupDrive).where(eq(backupDrive.id, d.id));
        await audit(tx, orgId, 'backup.drive.disconnect', 'backup', null);
      }
      return { ok: true };
    },
  });
}
