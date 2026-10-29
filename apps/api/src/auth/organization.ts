import { organization } from 'better-auth/plugins';

/**
 * Organizations, members and invitations (change 2.4). Organizations are created by the sign-up hook and members and
 * invitations are managed by modules/members, so the plugin's own create endpoint stays off.
 */
export const organizationPlugin = () => organization({ allowUserToCreateOrganization: false });
