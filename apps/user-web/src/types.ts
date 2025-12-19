export type CreatePurchaseResponse = {
  ok: true;
  purchase: {
    purchase_id: string;
    purchase_token: string;
    amount_cents: number;
    currency: string;
    validity_hours: number;
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

export type CheckAccessStatusResponse = {
  ok: true;
  status: {
    state: string;
    can_access: boolean;
    valid_until: string | null;
  };
};
