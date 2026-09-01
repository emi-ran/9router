# Mine Extensions

Fork-specific features live here to keep upstream 9Router changes small and easier to merge.

## Remember Me

Password login can issue a persistent dashboard session when **Remember me** is selected:

- Access token lifetime: 24 hours
- Refresh token lifetime: 7 days
- Both cookies are HTTP-only and use the dashboard cookie security policy
- Authenticated activity rotates both tokens and moves the refresh expiry seven days forward
- Login without **Remember me** keeps the existing non-persistent access cookie and clears any refresh cookie
- Logout clears both access and refresh cookies

Refresh tokens are accepted only for session renewal. They cannot directly authorize protected routes.

Implementation: `src/mine/auth/rememberMe.js` and `src/mine/auth/RememberMeCheckbox.js`.
