# Civilon Price Check staff management

Only an active `ADMIN` with the `manage_staff` capability can use `/admin/staff`.

## Add staff

1. Open **Staff** in Civilon Operations.
2. Add the employee's exact Google email and choose `ADMIN`, `REVIEWER`, `ANALYST`, or `AUDITOR`.
3. Copy the displayed instruction: `Go to https://cvlon.com/admin/login and sign in with [email] using Google.`
4. The first verified Google sign-in binds the immutable Google issuer and subject, creates the local account with the selected role, and accepts the invitation.

The bootstrap environment allowlist remains recovery-only. Do not add ordinary staff there.

## Manage staff

- Role changes take effect immediately and revoke existing sessions.
- Disabling an account revokes all sessions. Re-enabling requires a new Google sign-in.
- **Revoke sessions** signs an employee out everywhere without disabling their account.
- The final active `ADMIN` cannot be disabled or downgraded.

All invitation, binding, role, disable/re-enable, and session-revocation actions are retained in the audit log. Never place a guessed Google subject in `admin_users`; only verified first login performs the binding.
