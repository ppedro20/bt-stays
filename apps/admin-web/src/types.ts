export type AdminListResponse = {
  ok: true;
  server_time: string;
  me: {
    user_id: string;
    role: "admin" | "superadmin";
  };
  codes: Array<{
    code_id: string;
    purchase_id: string;
    product_code: string;
    purchase_status: string;
    code_last2: string;
    code_plaintext: string | null;
    issued_at: string;
    valid_until: string;
    used_at: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    code_status: "issued" | "used" | "revoked" | "expired" | null;
  }>;
  audit: Array<{
    event_id: string;
    created_at: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    actor_type: string;
    actor_id: string | null;
    ip: string | null;
    details: unknown;
    synthetic: boolean;
  }>;
};

export type AdminCodeDetailResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  code: AdminListResponse["codes"][number];
  payment: {
    payment_id: string;
    status: string;
    created_at: string;
    paid_at: string | null;
    canceled_at: string | null;
    confirmed_via: string | null;
    confirmed_at: string | null;
    provider: string | null;
    provider_payment_id: string | null;
    provider_status: string | null;
  } | null;
  events: Array<{
    event_id: string;
    created_at: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    actor_type: string;
    actor_id: string | null;
    ip: string | null;
    details: unknown;
    synthetic: boolean;
  }>;
};

export type AdminPaymentsListResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  payments: Array<{
    payment_id: string;
    status: string;
    created_at: string;
    paid_at: string | null;
    canceled_at: string | null;
    product_code: string;
    validity_hours: number;
    amount_cents: number;
    currency: string;
    access_code_id: string | null;
    confirmed_via: string | null;
    confirmed_at: string | null;
    provider: string | null;
    provider_payment_id: string | null;
    provider_status: string | null;
  }>;
};

export type AdminEventsResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  events: AdminCodeDetailResponse["events"];
};

export type AdminRfidListResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  cards: Array<{
    card_id: string;
    card_uid: string;
    permanent: boolean;
    keycard: string | null;
    access_code_id: string | null;
    code_plaintext: string | null;
    code_status: "issued" | "used" | "revoked" | "expired" | null;
    valid_until: string | null;
    created_at: string;
    updated_at: string;
  }>;
  logs: Array<{
    log_id: string;
    created_at: string;
    card_id: string | null;
    card_uid: string;
    access_code_id: string | null;
    keycard: string | null;
    granted: boolean;
    reason: string;
  }>;
};

export type AdminRfidUpsertResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  card: {
    card_id: string;
    card_uid: string;
    access_code_id: string | null;
    permanent: boolean;
    keycard: string | null;
  };
};
