export type CreatePurchaseResponse = {
  ok: true;
  purchase: {
    purchase_id: string;
    purchase_token: string;
    amount_cents: number;
    currency: string;
    validity_hours: number;
    provider?: string;
    checkout_url?: string | null;
  };
};

export type DemoPayResponse = {
  ok: true;
  result: {
    purchase_id: string;
    access_code: string;
    valid_until: string;
  };
};

export type PaymentStatusResponse = {
  ok: true;
  payment: {
    purchase_id: string;
    status: string;
    access_code: string | null;
    valid_until: string | null;
  };
};

export type CheckAccessStatusResponse = {
  ok: true;
  server_time: string;
  status: {
    state: string;
    can_access: boolean;
    valid_until: string | null;
  };
};
