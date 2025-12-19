export type AdminListResponse = {
  ok: true;
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
    issued_at: string;
    valid_until: string;
    used_at: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    code_status: "issued" | "used" | "revoked" | "expired";
  }>;
  audit: Array<{
    id: number;
    created_at: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    actor_type: string;
    actor_id: string | null;
    ip: string | null;
    details: unknown;
  }>;
};

export type AdminCodeDetailResponse = {
  ok: true;
  me: { user_id: string; role: "admin" | "superadmin" };
  code: AdminListResponse["codes"][number];
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
