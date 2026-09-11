"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Identifies the worker currently using this browser tab. The name is set once
 * when the worker opens the terminal and is persisted in localStorage so the
 * same browser keeps the same identity across refreshes.
 *
 * Important: this is purely a soft identity — the server trusts the caller
 * (the terminals run on staff devices behind the owner's account). RLS or
 * stronger auth would be added alongside a real auth flow.
 */

export interface WorkerIdentity {
  id: string;
  name: string;
  role: "Cashier" | "Manager";
}

interface WorkerIdentityCtx {
  worker: WorkerIdentity | null;
  setName: (name: string) => void;
  clear: () => void;
}

const WorkerIdentityContext = createContext<WorkerIdentityCtx | null>(null);

const KEY = "sufra.worker.id.v1";

function genId(): string {
  const rand = () => Math.random().toString(36).slice(2, 6);
  return `w-${rand()}${rand()}`;
}

export function WorkerIdentityProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<WorkerIdentity | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WorkerIdentity;
        if (parsed?.id && parsed?.name) {
          setWorker(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    setWorker(null);
  }, []);

  const persist = (next: WorkerIdentity | null) => {
    try {
      if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
      else window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  const setName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next: WorkerIdentity = {
      id: worker?.id ?? genId(),
      name: trimmed,
      role: worker?.role ?? "Cashier",
    };
    setWorker(next);
    persist(next);
  };

  const clear = () => {
    setWorker(null);
    persist(null);
  };

  return (
    <WorkerIdentityContext.Provider value={{ worker, setName, clear }}>
      {children}
    </WorkerIdentityContext.Provider>
  );
}

export function useWorkerIdentity(): WorkerIdentityCtx {
  const ctx = useContext(WorkerIdentityContext);
  if (!ctx) throw new Error("useWorkerIdentity must be inside WorkerIdentityProvider");
  return ctx;
}
