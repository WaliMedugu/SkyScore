// Synthetic people for the sandbox bank. Names and numbers are made up; the farm boundaries are real
// fields (from data/snapshots) whose satellite history drives every score and alert.

export interface SeedDealer {
  key: string;
  name: string;
  owner: string;
  address: string;
  state: string;
  /** Snapshot cluster the shop serves. */
  cluster: string;
  /** Offset from the cluster's centre, in degrees, so shops don't sit on a farm. */
  offset: [number, number];
}

export const DEALERS: SeedDealer[] = [
  { key: "albarka", name: "Albarka Agro Inputs", owner: "Musa Albarka", address: "Samaru Market, Zaria", state: "Kaduna", cluster: "zaria", offset: [0.012, 0.009] },
  { key: "kofar-doka", name: "Kofar Doka Farm Centre", owner: "Hadiza Lawal", address: "Kofar Doka, Zaria City", state: "Kaduna", cluster: "zaria", offset: [-0.015, -0.006] },
  { key: "kachia-store", name: "Kachia Farmers' Store", owner: "Elisha Bawa", address: "Kachia Main Market", state: "Kaduna", cluster: "kachia", offset: [0.01, -0.008] },
  { key: "gbako-rice", name: "Gbako Rice Inputs", owner: "Isah Ndayako", address: "Old Market Road, Bida", state: "Niger", cluster: "bida", offset: [-0.011, 0.007] },
  { key: "kuje-hub", name: "Kuje Agro Hub", owner: "Ngozi Eze", address: "Kuje Market, FCT", state: "FCT", cluster: "kuje", offset: [0.009, 0.01] },
  { key: "gwagwalada-seeds", name: "Gwagwalada Seeds & Agrochem", owner: "Bala Gimba", address: "Gwagwalada Main Market, FCT", state: "FCT", cluster: "kuje", offset: [-0.02, 0.016] },
];

export const HUBS: Record<string, { hub: string; coop: string; lang: string }> = {
  zaria: { hub: "Zaria Youth Agripreneur Hub", coop: "Samaru Young Farmers Cooperative", lang: "ha" },
  kachia: { hub: "Kachia Young Farmers Hub", coop: "Kachia Grains Youth Cooperative", lang: "en" },
  bida: { hub: "Bida Rice Youth Hub", coop: "Gbako Rice Youth Cooperative", lang: "ha" },
  kuje: { hub: "Kuje Agripreneur Hub", coop: "Kuje Youth Agro Cooperative", lang: "en" },
};

export interface SeedFarmer {
  first: string;
  last: string;
  gender: "female" | "male";
  born: number;
  /** Real field this farmer brings (snapshot key). */
  snap: string;
  bvn?: boolean;
  trained?: boolean;
  coop?: boolean;
  lang?: string;
  tenure?: "owned" | "family" | "leased" | "allocated" | "rented";
  /** Had a 2024 SkyScore loan: repaid on time, or late. */
  history?: "ontime" | "late";
  /** If the 2025 application is approved: accept it, or leave the offer waiting for the farmer's consent. */
  plan?: "accept" | "pending";
  /** What the officer does if the score sends the application for review (default: alternate approve / leave in the queue). */
  review?: { action: "approve" | "decline" | "leave"; note?: string };
}

export const FARMERS: SeedFarmer[] = [
  // Zaria, Kaduna — maize, sorghum, soybean, groundnut
  { first: "Abdullahi", last: "Musa", gender: "male", born: 1999, snap: "farm-zaria-01", coop: true, history: "ontime", tenure: "family" },
  { first: "Hauwa", last: "Sani", gender: "female", born: 2001, snap: "farm-zaria-02", coop: true, history: "ontime", tenure: "family" },
  { first: "Ibrahim", last: "Lawal", gender: "male", born: 1997, snap: "farm-zaria-03", tenure: "leased" },
  { first: "Zainab", last: "Abubakar", gender: "female", born: 2002, snap: "farm-zaria-04", coop: true, tenure: "allocated" },
  { first: "Sadiq", last: "Garba", gender: "male", born: 1996, snap: "farm-zaria-05", history: "late", tenure: "family" },
  { first: "Rukayya", last: "Bello", gender: "female", born: 2003, snap: "farm-zaria-06", coop: true, plan: "pending", tenure: "allocated" },
  { first: "Aminu", last: "Shehu", gender: "male", born: 1998, snap: "farm-zaria-07", trained: false, tenure: "rented" },
  { first: "Maryam", last: "Idris", gender: "female", born: 2000, snap: "farm-zaria-08", coop: true, history: "ontime", tenure: "family" },
  { first: "Yusuf", last: "Adamu", gender: "male", born: 2004, snap: "farm-zaria-09", tenure: "family" },
  { first: "Halima", last: "Umar", gender: "female", born: 1997, snap: "farm-zaria-10", coop: true, tenure: "owned" },
  // Kachia, Kaduna — maize, soybean, sorghum
  { first: "Daniel", last: "Bako", gender: "male", born: 1998, snap: "farm-kachia-01", coop: true, history: "ontime", tenure: "family" },
  { first: "Grace", last: "Yakubu", gender: "female", born: 2000, snap: "farm-kachia-02", coop: true, tenure: "family" },
  { first: "Emmanuel", last: "Kure", gender: "male", born: 1996, snap: "farm-kachia-03", tenure: "owned" },
  { first: "Esther", last: "Dauda", gender: "female", born: 2001, snap: "farm-kachia-04", coop: true, history: "ontime", tenure: "family" },
  { first: "Samuel", last: "Ayuba", gender: "male", born: 1999, snap: "farm-kachia-05", tenure: "leased" },
  { first: "Rhoda", last: "Gambo", gender: "female", born: 1998, snap: "farm-kachia-06", coop: true, tenure: "allocated" },
  { first: "Joshua", last: "Tanko", gender: "male", born: 2005, snap: "farm-kachia-07", bvn: false, tenure: "family", review: { action: "leave" } },
  { first: "Comfort", last: "Bulus", gender: "female", born: 1997, snap: "farm-kachia-08", coop: true, tenure: "family" },
  // Bida, Niger — rice and maize
  { first: "Mohammed", last: "Ndako", gender: "male", born: 1997, snap: "farm-bida-01", coop: true, history: "ontime", tenure: "family" },
  { first: "Aishat", last: "Gana", gender: "female", born: 2000, snap: "farm-bida-02", coop: true, tenure: "allocated" },
  { first: "Usman", last: "Kolo", gender: "male", born: 1999, snap: "farm-bida-03", tenure: "leased" },
  { first: "Fatima", last: "Ndagi", gender: "female", born: 2002, snap: "farm-bida-04", coop: true, tenure: "family" },
  { first: "Abubakar", last: "Jiya", gender: "male", born: 1996, snap: "farm-bida-05", trained: false, tenure: "rented" },
  // Kuje, FCT — maize, soybean, sorghum
  { first: "Joseph", last: "Gimba", gender: "male", born: 1998, snap: "farm-kuje-01", coop: true, history: "ontime", tenure: "family" },
  { first: "Blessing", last: "Audu", gender: "female", born: 2000, snap: "farm-kuje-02", coop: true, tenure: "allocated" },
  { first: "Chinedu", last: "Eze", gender: "male", born: 1997, snap: "farm-kuje-03", lang: "pcm", tenure: "leased" },
  { first: "Ruth", last: "Danjuma", gender: "female", born: 1999, snap: "farm-kuje-04", coop: true, plan: "pending", tenure: "family" },
  { first: "Yetunde", last: "Adebayo", gender: "female", born: 2001, snap: "farm-kuje-05", lang: "yo", tenure: "rented" },
  { first: "Peter", last: "Shekwo", gender: "male", born: 1996, snap: "farm-kuje-06", coop: true, tenure: "family" },
  { first: "Victoria", last: "Zhiri", gender: "female", born: 2003, snap: "farm-kuje-07", coop: true, tenure: "allocated" },
  // Applicants who mapped land that isn't farmed (the ghost-farm check catches both)
  {
    first: "Kabiru",
    last: "Tijani",
    gender: "male",
    born: 1996,
    snap: "control-zuma",
    trained: false,
    tenure: "owned",
    review: { action: "decline", note: "Agent visit: bushland at the foot of Zuma Rock, no sign of a farm. Land-cover maps agree. Declined." },
  },
  { first: "Felix", last: "Okon", gender: "male", born: 1997, snap: "control-kagoro-woodland", trained: false, tenure: "leased" },
];

/** Notes an officer leaves when approving an application that the score sent for review. */
export const REVIEW_NOTES = [
  "Agent visited the field: cleared and ridged, owner confirmed by the village head. Approve the smaller offer.",
  "Called the cooperative secretary; farmer is an active member. Approve.",
  "Two seasons patchy from space but the farmer was away at training. Approve at reduced size.",
];
