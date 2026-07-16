# Coolify Service Role Runbook for Demo Smoke

This runbook explains how to use the Supabase service-role key for demo seeding without printing it or storing it in the repository.

## Rules

- Do not commit, paste, screenshot, or document the real `SUPABASE_SERVICE_ROLE_KEY`.
- Do not add the key to `.env`, `.env.local`, Markdown files, issue comments, chat, or shell scripts.
- Use the key only in a short-lived shell session and clear it after the command finishes.
- Never expose the key through `NEXT_PUBLIC_*` variables.

## Where to find it

Use the Coolify UI:

1. Open `http://192.168.0.22:8000`.
2. Open project/resource `exclusive`.
3. Open application ID `6` / UUID `x0k4840c84sc0wc4c0gwsk8w`.
4. Go to Environment Variables.
5. Locate `SUPABASE_SERVICE_ROLE_KEY`.
6. Copy the value only into the temporary shell prompt below.

The production app uses:

- Production URL: `http://192.168.0.22:31010`
- Supabase internal URL: `http://192.168.0.22:8012`
- Supabase Studio: `http://192.168.0.22:3011/project/default`

## Seed demo users safely on Windows PowerShell

Run from the `app` directory. The passwords below are demo-only examples; replace them with temporary values and do not reuse production passwords.

```powershell
$env:SUPABASE_INTERNAL_URL = "http://192.168.0.22:8012"
$env:DEMO_BASE_URL = "http://192.168.0.22:31010"
# Optional: set this only when using a fixture different from the smoke runner default.
# $env:DEMO_BROKER_REPORT_PATH = "../broker-report-example.xls"

$env:DEMO_ADMIN_EMAIL = "demo-admin@example.com"
$env:DEMO_ADMIN_PASSWORD = "replace-with-temporary-admin-password"
$env:DEMO_EDITOR_EMAIL = "demo-editor@example.com"
$env:DEMO_EDITOR_PASSWORD = "replace-with-temporary-editor-password"
$env:DEMO_VIEWER_EMAIL = "demo-viewer@example.com"
$env:DEMO_VIEWER_PASSWORD = "replace-with-temporary-viewer-password"

$serviceRole = Read-Host "Paste SUPABASE_SERVICE_ROLE_KEY" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($serviceRole)
try {
  $env:SUPABASE_SERVICE_ROLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  npm run demo:seed-users
  npm run smoke:browser-demo
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
```

The `Read-Host -AsSecureString` prompt keeps the key out of the command line and avoids writing it into shell history.

## After the run

- Rotate demo passwords if they were shared.
- Clear temporary variables if the shell remains open:

```powershell
Remove-Item Env:\DEMO_ADMIN_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\DEMO_EDITOR_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\DEMO_VIEWER_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
```

- Record only the smoke result, target URL, commit SHA, and timestamp in checklists.
- Do not record the service-role key or demo passwords.
