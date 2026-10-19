// Analyse a field and follow it live: one streamed request (server-sent events over fetch) that ends with the
// scored result. Works the same on a single server and on serverless hosting.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Polygon } from "@skyscore/engine";
import { ApiError, errorText } from "./api";
import type { Analysis, Offer, OpticalPoint, SeasonResult } from "./types";

export interface JobProgress {
  stage: string;
  done: number;
  total: number;
  message: string;
}

export type StreamResult = Analysis & { offers: Record<string, Offer | null>; profile: string };

export interface JobState {
  status: "idle" | "starting" | "running" | "done" | "error";
  analysisId: string | null;
  progress: JobProgress | null;
  messages: string[];
  observations: OpticalPoint[];
  seasons: Pick<SeasonResult, "year" | "label" | "peak" | "complete">[];
  result: StreamResult | null;
  error: string | null;
}

const IDLE: JobState = { status: "idle", analysisId: null, progress: null, messages: [], observations: [], seasons: [], result: null, error: null };

interface ObsEvent {
  obs: { date: string; sceneId: string; ndvi: number; cloud: number; water: number; validPct: number };
}

/** Read `event:` / `data:` blocks from a server-sent-events body. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent(event, data.join("\n"));
    }
  }
}

/** Run an analysis and follow it live. Observations are batched per animation frame so the chart stays smooth. */
export function useAnalysisJob() {
  const [state, setState] = useState<JobState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<OpticalPoint[]>([]);
  const raf = useRef(0);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);
  useEffect(() => stop, [stop]);

  const flush = useCallback(() => {
    raf.current = 0;
    const batch = pending.current;
    pending.current = [];
    if (batch.length) setState((s) => ({ ...s, observations: [...s.observations, ...batch] }));
  }, []);

  const onEvent = useCallback(
    (event: string, raw: string) => {
      const data = JSON.parse(raw) as Record<string, unknown>;
      switch (event) {
        case "progress": {
          const p = data as unknown as JobProgress;
          setState((s) => ({ ...s, status: "running", progress: p, messages: p.message && s.messages.at(-1) !== p.message ? [...s.messages.slice(-6), p.message] : s.messages }));
          break;
        }
        case "observation": {
          const { obs } = data as unknown as ObsEvent;
          if (!obs) return;
          pending.current.push({ date: obs.date, ndvi: obs.ndvi, cloud: obs.cloud, water: obs.water, sceneId: obs.sceneId, clear: obs.cloud <= 0.15 && obs.validPct >= 60 });
          if (!raf.current) raf.current = requestAnimationFrame(flush);
          break;
        }
        case "partial":
          setState((s) => ({ ...s, seasons: (data as { seasons: JobState["seasons"] }).seasons }));
          break;
        case "done":
          setState((s) => ({ ...s, analysisId: (data as { analysisId: string }).analysisId ?? s.analysisId }));
          break;
        case "result":
          flush();
          setState((s) => ({ ...s, status: "done", result: data as unknown as StreamResult, analysisId: (data as { id: string }).id }));
          break;
        case "error":
          setState((s) => ({ ...s, status: "error", error: (data as { message?: string }).message ?? "The analysis failed." }));
          break;
      }
    },
    [flush],
  );

  const start = useCallback(
    async (polygon: Polygon, opts: { crop?: string; fresh?: boolean } = {}) => {
      stop();
      pending.current = [];
      const controller = new AbortController();
      abort.current = controller;
      setState({ ...IDLE, status: "starting" });
      try {
        const res = await fetch("/api/v1/analyses/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ polygon, ...opts }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { field: string; message: string }[] } } | null;
          throw new ApiError(res.status, err?.error?.message ?? `The analysis could not start (${res.status}).`, err?.error?.details);
        }
        setState((s) => ({ ...s, status: "running" }));
        await readEvents(res.body, onEvent);
        setState((s) => (s.status === "running" ? { ...s, status: "error", error: "The connection closed before the analysis finished. Try again." } : s));
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setState((s) => ({ ...s, status: "error", error: errorText(e) }));
      }
    },
    [onEvent, stop],
  );

  const reset = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  return { state, start, reset };
}
