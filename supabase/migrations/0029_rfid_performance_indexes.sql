-- MODULE 29 - RFID PERFORMANCE INDEXES
-- Cover foreign keys flagged by Supabase performance advisor.

create index if not exists rfid_logs_access_code_id_idx
  on public.rfid_logs (access_code_id);

create index if not exists rfid_logs_card_id_idx
  on public.rfid_logs (card_id);

create index if not exists rfid_remote_actions_card_id_idx
  on public.rfid_remote_actions (card_id);

create index if not exists rfid_remote_actions_requested_by_idx
  on public.rfid_remote_actions (requested_by);
