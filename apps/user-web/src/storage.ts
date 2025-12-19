const PURCHASE_TOKEN_KEY = "bt.purchase_token";
const PURCHASE_ID_KEY = "bt.purchase_id";
const ACCESS_CODE_KEY = "bt.access_code";
const VALID_UNTIL_KEY = "bt.valid_until";

export function savePurchase(purchaseId: string, purchaseToken: string) {
  sessionStorage.setItem(PURCHASE_ID_KEY, purchaseId);
  sessionStorage.setItem(PURCHASE_TOKEN_KEY, purchaseToken);
}

export function loadPurchase(): { purchaseId: string | null; purchaseToken: string | null } {
  return {
    purchaseId: sessionStorage.getItem(PURCHASE_ID_KEY),
    purchaseToken: sessionStorage.getItem(PURCHASE_TOKEN_KEY),
  };
}

export function clearPurchase() {
  sessionStorage.removeItem(PURCHASE_ID_KEY);
  sessionStorage.removeItem(PURCHASE_TOKEN_KEY);
}

export function saveAccessCode(code: string, validUntil: string) {
  sessionStorage.setItem(ACCESS_CODE_KEY, code);
  sessionStorage.setItem(VALID_UNTIL_KEY, validUntil);
}

export function loadAccessCode(): { code: string | null; validUntil: string | null } {
  return {
    code: sessionStorage.getItem(ACCESS_CODE_KEY),
    validUntil: sessionStorage.getItem(VALID_UNTIL_KEY),
  };
}

export function clearAccessCode() {
  sessionStorage.removeItem(ACCESS_CODE_KEY);
  sessionStorage.removeItem(VALID_UNTIL_KEY);
}
