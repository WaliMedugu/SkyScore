// Sandbox adapters for systems only Ecobank can connect: core banking, BVN lookup, SMS.
// Each has the shape a production integration would have, so swapping in the real service is local.
import { randomInt } from "node:crypto";
import { all, logEvent, now, one, run } from "./db.ts";
import { ApiError } from "./util.ts";

/* ── Core banking (accounts and transfers) ─────────────────────────────── */

export interface Account {
  account_no: string;
  owner_type: "farmer" | "dealer" | "bank";
  owner_id: string;
  name: string;
  balance: number;
}

export const core = {
  /** Open (or return) the owner's Ecobank account. NUBAN-shaped 10-digit number, sandbox only. */
  openAccount(ownerType: Account["owner_type"], ownerId: string, name: string, opening = 0): Account {
    const existing = one<Account>("SELECT * FROM accounts WHERE owner_type = ? AND owner_id = ?", ownerType, ownerId);
    if (existing) return existing;
    let accountNo = "";
    do accountNo = `0${String(randomInt(100_000_000, 999_999_999))}`;
    while (one("SELECT 1 FROM accounts WHERE account_no = ?", accountNo));
    run("INSERT INTO accounts(account_no, owner_type, owner_id, name, balance, created_at) VALUES(?,?,?,?,?,?)", accountNo, ownerType, ownerId, name, opening, now());
    return one<Account>("SELECT * FROM accounts WHERE account_no = ?", accountNo)!;
  },
  get(accountNo: string): Account | undefined {
    return one<Account>("SELECT * FROM accounts WHERE account_no = ?", accountNo);
  },
  forOwner(ownerType: Account["owner_type"], ownerId: string): Account | undefined {
    return one<Account>("SELECT * FROM accounts WHERE owner_type = ? AND owner_id = ?", ownerType, ownerId);
  },
  credit(accountNo: string, amount: number, memo: string) {
    if (amount <= 0) throw new ApiError(400, "Amount must be positive.");
    const r = run("UPDATE accounts SET balance = balance + ? WHERE account_no = ?", Math.round(amount), accountNo);
    if (!r.changes) throw new ApiError(404, "Account not found.");
    logEvent("account", accountNo, "CREDIT", `${memo}: +₦${Math.round(amount).toLocaleString("en-NG")}`);
  },
  debit(accountNo: string, amount: number, memo: string) {
    const acc = core.get(accountNo);
    if (!acc) throw new ApiError(404, "Account not found.");
    if (acc.balance < amount) throw new ApiError(422, `Insufficient balance: ₦${acc.balance.toLocaleString("en-NG")} available.`);
    run("UPDATE accounts SET balance = balance - ? WHERE account_no = ?", Math.round(amount), accountNo);
    logEvent("account", accountNo, "DEBIT", `${memo}: -₦${Math.round(amount).toLocaleString("en-NG")}`);
  },
};

/* ── Identity (BVN via NIBSS iGree in production) ───────────────────────── */

export interface BvnResult {
  verified: boolean;
  provider: string;
  message: string;
  nameMatch: boolean;
}

/**
 * Sandbox rules: 11 digits required; a BVN ending in "000" simulates a name mismatch.
 * Production: NIBSS iGree consent flow (the customer approves the lookup on their phone).
 */
export function verifyBvn(bvn: string, firstName: string, lastName: string): BvnResult {
  const provider = "NIBSS BVN (sandbox)";
  if (!/^\d{11}$/.test(bvn)) return { verified: false, provider, nameMatch: false, message: "A BVN has exactly 11 digits." };
  if (bvn.endsWith("000")) return { verified: false, provider, nameMatch: false, message: `The name on this BVN doesn't match ${firstName} ${lastName}.` };
  return { verified: true, provider, nameMatch: true, message: `BVN matches ${firstName} ${lastName}.` };
}

/* ── SMS (Africa's Talking / Termii in production) ──────────────────────── */

export type SmsKind = "OTP" | "APPROVED" | "DECLINED" | "VOUCHER" | "REDEEMED" | "TRANCHE" | "ALERT" | "REMINDER" | "RECEIPT" | "INFO";

export function sendSms(to: string, body: string, kind: SmsKind) {
  run("INSERT INTO sms(to_phone, body, kind, created_at) VALUES(?,?,?,?)", to, body, kind, now());
}

export function smsFor(phone?: string, limit = 50) {
  return phone
    ? all("SELECT * FROM sms WHERE to_phone = ? ORDER BY id DESC LIMIT ?", phone, limit)
    : all("SELECT * FROM sms ORDER BY id DESC LIMIT ?", limit);
}
