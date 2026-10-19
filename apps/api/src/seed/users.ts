// Demo sign-ins for the sandbox bank. Change every PIN before any real deployment.
import type { Role } from "../auth.ts";

export interface DemoUser {
  username: string;
  name: string;
  role: Role;
  pin: string;
  phone: string;
  /** For dealer users: the shop they work at (key in data.ts DEALERS). */
  dealer?: string;
  title: string;
}

export const DEMO_USERS: DemoUser[] = [
  { username: "amina", name: "Amina Yusuf", role: "officer", pin: "2468", phone: "08030000101", title: "Agri-finance loan officer, Kaduna" },
  { username: "ibrahim", name: "Ibrahim Danladi", role: "agent", pin: "1357", phone: "08030000102", title: "Field agent, Zaria and Kachia" },
  { username: "grace", name: "Grace Ayuba", role: "agent", pin: "1357", phone: "08030000103", title: "Field agent, Bida and Kuje" },
  { username: "musa", name: "Musa Albarka", role: "dealer", pin: "8642", phone: "08030000104", dealer: "albarka", title: "Albarka Agro Inputs, Samaru" },
  { username: "ngozi", name: "Ngozi Eze", role: "dealer", pin: "8642", phone: "08030000105", dealer: "kuje-hub", title: "Kuje Agro Hub" },
  { username: "admin", name: "SkyScore Admin", role: "admin", pin: "9999", phone: "08030000106", title: "Administrator" },
];

/** Every seeded farmer's USSD PIN (dial *326*77# in the console's USSD simulator). */
export const DEMO_FARMER_USSD_PIN = "1234";
