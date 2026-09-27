# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- GitHub: **Security → Report a vulnerability** on this repository
  (a private advisory only the maintainers can see).

Include what you found, how to reproduce it, and the version (Settings →
About). You'll get an acknowledgement within a few days and a fix or a plan
for one as soon as it's understood. Credit is given in the release notes
unless you'd rather stay anonymous.

Each running instance also publishes its contact at
`/.well-known/security.txt`; an operator can change it with `SECURITY_CONTACT`.

## Supported versions

Fixes land in the latest release. Upgrade to get them; there are no backports
to older versions.

## What's in place

- Passwords hashed with argon2; optional TOTP two-factor and passkeys.
- Single sign-on (OpenID Connect with PKCE) and trusted-proxy sign-in, the
  latter only from addresses the operator lists.
- Secrets saved in Settings are encrypted at rest (AES-256-GCM) with a key kept
  outside the database.
- API tokens are stored as hashes, can be read-only, expire, and never open
  locked notebooks or pages.
- A strict Content-Security-Policy on the app, and an audit log of sign-ins,
  security changes and admin actions.
- Backups contain decrypted secrets and every note: store them like the data
  they are.
