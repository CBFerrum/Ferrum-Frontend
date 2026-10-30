/** Where single sign-on providers send people back after signing in (registered with each provider):
 *  today's web app's sign-in address, which the server sends on to the sign-in page. */
export const ssoRedirectUri = (): string => `${window.location.origin}/app/login`;
