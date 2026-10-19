// USSD menu for farmers on any phone. Africa's Talking request/response format:
// in: sessionId, serviceCode, phoneNumber, text ("1*2*5000" = choices so far); out: "CON …" (continue) or "END …".
import { checkPin } from "./auth.ts";
import { all, one } from "./db.ts";
import { repay } from "./lending.ts";
import { naira } from "./util.ts";
import { loanMoney, type FarmerRow, type LoanRow, type VoucherRow } from "./views.ts";
import type { MonitorResult } from "@skyscore/engine";

const OPEN = "('ACTIVE','T2_RELEASED','T2_HELD','RESTRUCTURED','DEFAULTED','ACCEPTED')";
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Normalise +234 / 234 / 0 prefixes so lookups match the stored 0-prefixed number. */
export function normalisePhone(p: string): string {
  const d = p.replace(/[^\d]/g, "");
  if (d.startsWith("234")) return `0${d.slice(3)}`;
  return d.startsWith("0") ? d : `0${d}`;
}

export function ussdReply(phoneNumber: string, text: string): string {
  const phone = normalisePhone(phoneNumber);
  const farmer = one<FarmerRow & { ussd_pin_hash: string | null }>("SELECT * FROM farmers WHERE phone = ?", phone);
  if (!farmer) return "END This number isn't registered with SkyScore. Visit an Ecobank agent or a SkyScore youth hub to apply.";
  const loan = one<LoanRow>(`SELECT * FROM loans WHERE farmer_id = ? AND state IN ${OPEN} ORDER BY created_at DESC LIMIT 1`, farmer.id);
  const parts = text ? text.split("*") : [];

  if (parts.length === 0) {
    return `CON SkyScore by Ecobank\nWelcome ${farmer.first_name}\n1. My loan\n2. Repay loan\n3. Farm health\n4. My vouchers\n5. Call me back`;
  }
  switch (parts[0]) {
    case "1": {
      if (!loan) return "END You have no active SkyScore loan. Ask your agent about this season's inputs.";
      const { outstanding } = loanMoney(loan);
      return `END ${loan.crop[0].toUpperCase()}${loan.crop.slice(1)} input loan\nOwed: ${naira(outstanding)}\nDue: ${fmt(loan.due_date)}\nStatus: ${loan.state.replace("_", " ").toLowerCase()}`;
    }
    case "2": {
      if (!loan) return "END You have no loan to repay.";
      const { outstanding } = loanMoney(loan);
      if (parts.length === 1) return `CON You owe ${naira(outstanding)}.\nEnter amount to repay:`;
      const amount = Math.round(Number(parts[1]));
      if (!Number.isFinite(amount) || amount <= 0) return "END That amount isn't valid. Dial again.";
      if (amount > outstanding) return `END You only owe ${naira(outstanding)}. Dial again with a smaller amount.`;
      if (parts.length === 2) return `CON Repay ${naira(amount)} from account ${farmer.account_no ?? ""}?\nEnter your 4-digit PIN:`;
      if (!checkPin(parts[2], farmer.ussd_pin_hash)) return "END Wrong PIN. For your safety, dial again.";
      try {
        const r = repay(loan.id, amount, "USSD", null);
        return r.outstanding <= 0 ? `END Paid ${naira(amount)}. Your loan is fully repaid. Thank you!` : `END Paid ${naira(amount)}. Balance ${naira(r.outstanding)}. Thank you!`;
      } catch (e) {
        return `END ${e instanceof Error ? e.message : "Payment failed."}`;
      }
    }
    case "3": {
      if (!loan) return "END Farm health is shown for active loans.";
      const m = loan.monitor ? (JSON.parse(loan.monitor) as MonitorResult) : null;
      if (!m) return "END We haven't checked your farm from space yet. Try again tomorrow.";
      const ndvi = m.latestNdvi !== null ? ` Greenness ${m.latestNdvi.toFixed(2)}.` : "";
      return `END Farm health: ${m.health.toLowerCase().replace("_", " ")}.${ndvi}\n${m.summary}`;
    }
    case "4": {
      if (!loan) return "END You have no vouchers.";
      const vs = all<VoucherRow>("SELECT * FROM vouchers WHERE loan_id = ? ORDER BY tranche", loan.id);
      const lines = vs.map((v) => `${v.code} (${v.status === "HELD" ? "on hold" : v.status.toLowerCase()}): ${naira(v.amount)}`);
      return `END ${lines.join("\n") || "No vouchers."}`;
    }
    case "5":
      return "END Thank you. Your Ecobank agent will call you back within 24 hours.";
    default:
      return "END Invalid choice. Dial again.";
  }
}
