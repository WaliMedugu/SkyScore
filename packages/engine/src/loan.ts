// Loan lifecycle and double-entry postings. Pure: the API persists what these return.

export type LoanState =
  | "OFFERED"
  | "ACCEPTED"
  | "ACTIVE"
  | "T2_RELEASED"
  | "T2_HELD"
  | "REPAID"
  | "DEFAULTED"
  | "RESTRUCTURED"
  | "DECLINED"
  | "EXPIRED";

export type LoanEvent =
  | "ACCEPT"
  | "REDEEM_T1"
  | "RELEASE_T2"
  | "HOLD_T2"
  | "REPAY_FULL"
  | "DEFAULT"
  | "RESTRUCTURE"
  | "DECLINE"
  | "EXPIRE";

const TRANSITIONS: Record<LoanState, Partial<Record<LoanEvent, LoanState>>> = {
  OFFERED: { ACCEPT: "ACCEPTED", DECLINE: "DECLINED", EXPIRE: "EXPIRED" },
  ACCEPTED: { REDEEM_T1: "ACTIVE", EXPIRE: "EXPIRED" },
  ACTIVE: { RELEASE_T2: "T2_RELEASED", HOLD_T2: "T2_HELD", REPAY_FULL: "REPAID", DEFAULT: "DEFAULTED", RESTRUCTURE: "RESTRUCTURED" },
  T2_HELD: { RELEASE_T2: "T2_RELEASED", REPAY_FULL: "REPAID", DEFAULT: "DEFAULTED", RESTRUCTURE: "RESTRUCTURED" },
  T2_RELEASED: { REPAY_FULL: "REPAID", DEFAULT: "DEFAULTED", RESTRUCTURE: "RESTRUCTURED" },
  RESTRUCTURED: { REPAY_FULL: "REPAID", DEFAULT: "DEFAULTED" },
  REPAID: {},
  DEFAULTED: { REPAY_FULL: "REPAID" },
  DECLINED: {},
  EXPIRED: {},
};

export class LoanTransitionError extends Error {
  constructor(
    public readonly from: LoanState,
    public readonly event: LoanEvent,
  ) {
    super(`A loan that is ${from} cannot ${event.toLowerCase().replace(/_/g, " ")}.`);
  }
}

export function nextState(from: LoanState, event: LoanEvent): LoanState {
  const to = TRANSITIONS[from]?.[event];
  if (!to) throw new LoanTransitionError(from, event);
  return to;
}

export const canTransition = (from: LoanState, event: LoanEvent) => Boolean(TRANSITIONS[from]?.[event]);

export const LOAN_OPEN_STATES: LoanState[] = ["ACCEPTED", "ACTIVE", "T2_RELEASED", "T2_HELD", "RESTRUCTURED", "DEFAULTED"];

/* ── Ledger ─────────────────────────────────────────────────────────────── */

export interface Posting {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  kind: "VOUCHER_REDEEMED" | "FEES_CHARGED" | "DEALER_PAID" | "REPAYMENT" | "INSURANCE_CLAIM";
  memo: string;
  postings: Posting[];
}

export const accounts = {
  loan: (id: string) => `loan:${id}`,
  dealerPayable: (id: string) => `dealer-payable:${id}`,
  deposit: (owner: string) => `deposit:${owner}`,
  interestIncome: "income:interest",
  insuranceReserve: "reserve:insurance",
  settlement: "bank:settlement",
};

export function isBalanced(e: JournalEntry): boolean {
  const d = e.postings.reduce((a, p) => a + p.debit, 0);
  const c = e.postings.reduce((a, p) => a + p.credit, 0);
  return Math.round(d * 100) === Math.round(c * 100) && e.postings.every((p) => p.debit >= 0 && p.credit >= 0);
}

const entry = (kind: JournalEntry["kind"], memo: string, postings: Posting[]): JournalEntry => {
  const e = { kind, memo, postings };
  if (!isBalanced(e)) throw new Error(`Unbalanced journal entry: ${memo}`);
  return e;
};

/** Dealer delivered inputs against a voucher: the farmer now owes the bank, the bank owes the dealer. */
export function voucherRedeemed(loanId: string, dealerId: string, amount: number, code: string): JournalEntry {
  return entry("VOUCHER_REDEEMED", `Voucher ${code} redeemed`, [
    { account: accounts.loan(loanId), debit: amount, credit: 0 },
    { account: accounts.dealerPayable(dealerId), debit: 0, credit: amount },
  ]);
}

/** Bank pays the dealer into their Ecobank account. */
export function dealerPaid(dealerId: string, amount: number, code: string): JournalEntry {
  return entry("DEALER_PAID", `Settlement for voucher ${code}`, [
    { account: accounts.dealerPayable(dealerId), debit: amount, credit: 0 },
    { account: accounts.deposit(`dealer:${dealerId}`), debit: 0, credit: amount },
  ]);
}

/** Season interest and insurance premium added to what the farmer owes. */
export function feesCharged(loanId: string, interest: number, insurance: number): JournalEntry {
  return entry("FEES_CHARGED", "Season interest and crop insurance premium", [
    { account: accounts.loan(loanId), debit: interest + insurance, credit: 0 },
    { account: accounts.interestIncome, debit: 0, credit: interest },
    { account: accounts.insuranceReserve, debit: 0, credit: insurance },
  ]);
}

/** Farmer repays from their Ecobank account (USSD, app or agent). */
export function repayment(loanId: string, farmerId: string, amount: number, channel: string): JournalEntry {
  return entry("REPAYMENT", `Repayment via ${channel}`, [
    { account: accounts.deposit(`farmer:${farmerId}`), debit: amount, credit: 0 },
    { account: accounts.loan(loanId), debit: 0, credit: amount },
  ]);
}

/** Parametric insurance pays down the loan after a flood or drought trigger. */
export function insuranceClaim(loanId: string, amount: number, reason: string): JournalEntry {
  return entry("INSURANCE_CLAIM", `Insurance payout: ${reason}`, [
    { account: accounts.insuranceReserve, debit: amount, credit: 0 },
    { account: accounts.loan(loanId), debit: 0, credit: amount },
  ]);
}

/** Outstanding balance of an account from its postings (debit-positive). */
export function balanceOf(account: string, entries: JournalEntry[]): number {
  let b = 0;
  for (const e of entries) for (const p of e.postings) if (p.account === account) b += p.debit - p.credit;
  return Math.round(b * 100) / 100;
}

/** Make a voucher code like SKY-7K3Q-9XPA from a random source (0..1). */
export function voucherCode(rand: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I confusion
  const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
  return `SKY-${part()}-${part()}`;
}
