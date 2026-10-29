import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useEntitlements } from '../../features/billing/useEntitlements';
import type { Permission } from '../../lib/permissions';

interface CanProps {
  /** The permission the child needs. */
  do: Permission;
  children: ReactNode;
  /** What to show when not allowed. Default: nothing. */
  fallback?: ReactNode;
  /** Show the child disabled with a lock badge instead of hiding it (change 3.22). */
  lock?: boolean;
}

/**
 * Shows its children only to members whose role allows `do`. With `lock`, a button stays visible but greyed out with a
 * lock and a tooltip saying why, so people learn the feature exists and who can use it.
 */
export default function Can({ do: permission, children, fallback = null, lock = false }: CanProps) {
  const { can, role } = useEntitlements();
  if (can(permission)) return <>{children}</>;
  if (!lock) return <>{fallback}</>;
  return (
    <span className="can-locked" title={`Your role (${role ?? 'viewer'}) can not do this`} aria-disabled="true">
      <span className="can-locked-body" inert>
        {children}
      </span>
      <Lock size={12} className="can-lock-badge" aria-hidden="true" />
    </span>
  );
}
