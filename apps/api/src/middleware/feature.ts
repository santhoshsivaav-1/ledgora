import type { OrgContext } from './context.ts';

/**
 * Fourth link: is this feature in the organization's plan? Plans and limits arrive with Razorpay billing (change 4.4);
 * until then every feature is available, and routes can already name the one they belong to.
 */
export async function requireFeature(_ctx: OrgContext, _feature?: string) {
  return;
}
