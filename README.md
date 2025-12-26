## bt-stays-supabase
#### USER: https://bt-stays-user-web.vercel.app/
#### ADMIN: https://bt-stays-admin-web.vercel.app 

### Structure
- `apps/user-web` - public PWA
- `apps/admin-web` - admin dashboard
- `supabase` - migrations + Edge Functions
- `packages/shared` - shared UI/helpers

### Quick links
Minimal overview and pointers. For setup/run steps, use `RUNBOOK.md`.
- Runbook: `RUNBOOK.md`
- Supabase details: `supabase/README.md`

### RFID (future hardware)
- Current flow only sends card_uid to device_consume_rfid; no per-reader permissions.
- Recommended model: permissions per card UID plus device_id from each reader.
- Add devices table, rfid_card_devices join, and store device_id in rfid_logs.
- device_consume_rfid should accept device_id; consume_rfid validates card->device access.
- PIN entry can keep device_consume_code; card can be UID-only (server maps UID to keycard/PIN).
