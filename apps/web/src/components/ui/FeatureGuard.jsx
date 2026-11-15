import { useLocation } from 'react-router';
import { featureForWebPath } from '@ledgora/contracts';
import { useEntitlements } from '../../features/billing/useEntitlements';
import LockedFeature from './LockedFeature';

// One guard for every paid screen: the address says which feature it needs (contracts/plans.ts WEB_FEATURE_ROUTES), and
// a plan without it sees the lock card instead of the screen. The sidebar reads the same table for its lock icons.
export default function FeatureGuard({ children }) {
  const { pathname } = useLocation();
  const { hasFeature } = useEntitlements();
  const feature = featureForWebPath(pathname);
  if (feature && !hasFeature(feature)) return <LockedFeature feature={feature} />;
  return children;
}
