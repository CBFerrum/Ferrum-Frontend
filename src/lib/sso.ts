/** Where single sign-on providers send people back after signing in (registered with each provider). */
export const ssoRedirectUri = (): string => `${window.location.origin}${import.meta.env.BASE_URL}login`;
