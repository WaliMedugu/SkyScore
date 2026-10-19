// Signed-in user, shared across the app.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth, post, type User } from "./api";

interface Session {
  user: User | null;
  signIn: (username: string, pin: string) => Promise<User>;
  signOut: () => void;
}

const Ctx = createContext<Session>({ user: null, signIn: async () => Promise.reject(new Error("no session")), signOut: () => {} });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.user);
  const qc = useQueryClient();
  useEffect(() => {
    const sync = () => setUser(auth.user);
    window.addEventListener("skyscore:auth", sync);
    return () => window.removeEventListener("skyscore:auth", sync);
  }, []);
  const value: Session = {
    user,
    async signIn(username, pin) {
      const r = await post<{ token: string; user: User }>("/auth/login", { username, pin });
      qc.clear();
      auth.set(r.token, r.user);
      return r.user;
    },
    signOut() {
      auth.clear();
      qc.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const ROLE_LABEL: Record<User["role"], string> = { officer: "Loan officer", agent: "Field agent", dealer: "Agro-dealer", admin: "Administrator" };
