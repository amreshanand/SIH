"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";

const TOTAL_STEPS = 21;

interface DemoStatus {
  buses: number;
  events: number;
  issues: number;
  incidents: number;
  lifecycle_steps: number;
}

interface VerificationDetail {
  result?: string;
  unique_clear_count?: number;
  unique_detected_count?: number;
}

interface StepResult {
  step: number;
  action: string;
  message: string;
  issue_id?: string;
  issue_status?: string;
  event_id?: string;
  incident_id?: string;
  incident_status?: string;
  source?: string;
  verification?: VerificationDetail;
}

const actionColors: Record<string, string> = {
  EVENT: "text-orange-400",
  STATUS: "text-cyan-400",
  ASSIGN: "text-blue-400",
  STATUS_UPDATE: "text-purple-400",
  VERIFY: "text-green-400",
  INCIDENT: "text-red-400",
  NOTIFICATION: "text-yellow-400",
};

export default function DemoPage() {
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { messages, connected } = useWebSocket("events");
  const messagesKeyed = useMemo(() => messages.slice(0, 5), [messages]);

  useEffect(() => {
    api.getDemoStatus().then(setDemoStatus).catch(() => {});
  }, []);

  const refreshStatus = async () => {
    const status = await api.getDemoStatus();
    setDemoStatus(status);
  };

  const handleSeed = async () => {
    setError(null);
    try {
      await api.seedDemo();
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleReset = async () => {
    setError(null);
    setSteps([]);
    setCurrentStep(0);
    try {
      await api.resetDemo();
      setDemoStatus({ buses: 0, events: 0, issues: 0, incidents: 0, lifecycle_steps: TOTAL_STEPS });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleStep = async (stepNumber: number) => {
    setError(null);
    setRunning(true);
    try {
      const result = (await api.stepDemo(stepNumber)) as unknown as StepResult;
      setSteps((prev) => {
        const exists = prev.some((s) => s.step === result.step);
        return exists ? prev.map((s) => (s.step === result.step ? result : s)) : [...prev, result];
      });
      setCurrentStep(result.step);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleNext = () => {
    const target = currentStep + 1;
    if (target <= TOTAL_STEPS) handleStep(target);
  };

  const handleFastForward = async () => {
    setError(null);
    setRunning(true);
    try {
      const result = await api.runDemo();
      setSteps(result.steps_completed as unknown as StepResult[]);
      setCurrentStep(TOTAL_STEPS);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleSihMode = async () => {
    setError(null);
    setRunning(true);
    setSteps([]);
    setCurrentStep(0);
    try {
      const result = await api.runSihMode();
      setSteps(result.steps_completed as unknown as StepResult[]);
      setCurrentStep(TOTAL_STEPS);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const progress = Math.round((currentStep / TOTAL_STEPS) * 100);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Demo Control Panel</h1>
          <p className="text-sm text-gray-500">Walk the full DETECT→REPORT→ASSIGN→ACT→VERIFY→RESOLVE→REOPEN loop step-by-step</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge text="ALL DATA SIMULATED" variant="medium" />
          <Badge text={running ? "RUNNING" : "READY"} variant={running ? "critical" : "success"} />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* SIH MODE banner */}
      <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-semibold text-cyan-300">SIH MODE — One Click Presentation</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Cleans the database, seeds demo data, then runs all {TOTAL_STEPS} lifecycle steps automatically.</div>
        </div>
        <button
          onClick={handleSihMode}
          disabled={running}
          className="px-4 py-2 bg-cyan-500 text-gray-950 font-semibold rounded text-xs hover:bg-cyan-400 transition-colors disabled:opacity-50"
        >
          {running ? "RUNNING..." : "▶ RUN SIH MODE"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <span className="text-xs text-gray-400">Data Status</span>
            <Badge text="SIMULATED" variant="default" />
          </CardHeader>
          <div className="p-4 space-y-2 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">Buses</span><span className="text-gray-200">{demoStatus?.buses ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Events</span><span className="text-gray-200">{demoStatus?.events ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Issues</span><span className="text-gray-200">{demoStatus?.issues ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Incidents</span><span className="text-gray-200">{demoStatus?.incidents ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Lifecycle steps</span><span className="text-gray-200">{TOTAL_STEPS}</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-xs text-gray-400">Step Controls</span></CardHeader>
          <div className="p-4 grid grid-cols-2 gap-2">
            <button onClick={handleSihMode} disabled={running} className="col-span-2 px-3 py-2 bg-cyan-500 text-gray-950 font-medium rounded text-xs hover:bg-cyan-400 transition-colors disabled:opacity-50">
              SIH MODE
            </button>
            <button onClick={handleStep.bind(null, 1)} disabled={running || currentStep >= 1} className="px-3 py-2 bg-cyan-500/20 border border-cyan-500/30 rounded text-cyan-400 text-xs hover:bg-cyan-500/30 transition-colors disabled:opacity-40">
              START
            </button>
            <button onClick={handleNext} disabled={running || currentStep === 0 || currentStep >= TOTAL_STEPS} className="px-3 py-2 bg-blue-500/20 border border-blue-500/30 rounded text-blue-400 text-xs hover:bg-blue-500/30 transition-colors disabled:opacity-40">
              NEXT
            </button>
            <button onClick={handleFastForward} disabled={running} className="px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded text-purple-400 text-xs hover:bg-purple-500/30 transition-colors disabled:opacity-50">
              FAST-FORWARD
            </button>
            <button onClick={handleSeed} disabled={running} className="px-3 py-2 bg-cyan-500/20 border border-cyan-500/30 rounded text-cyan-400 text-xs hover:bg-cyan-500/30 transition-colors disabled:opacity-50">
              SEED
            </button>
            <button onClick={handleReset} disabled={running} className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-xs hover:bg-red-500/30 transition-colors disabled:opacity-50">
              RESET
            </button>
          </div>
          <div className="px-4 pb-4">
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>Progress</span>
              <span>{currentStep}/{TOTAL_STEPS} ({progress}%)</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs text-gray-400">Live WebSocket</span>
            <Badge text={connected ? "CONNECTED" : "OFFLINE"} variant={connected ? "success" : "critical"} />
          </CardHeader>
          <div className="p-4 space-y-1.5">
            {messagesKeyed.length === 0 && <p className="text-[10px] text-gray-600">No messages yet — run a step</p>}
            {messagesKeyed.map((m, i) => (
              <div key={i} className="p-1.5 bg-gray-800/50 rounded text-[10px] flex items-center justify-between">
                <div>
                  <span className="text-cyan-400">{typeof m.type === "string" ? m.type : "event"}</span>
                  {typeof m.step === "number" && <span className="text-gray-500 ml-1">step {m.step}</span>}
                </div>
                <Badge text="SIMULATED" variant="default" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <span className="text-sm font-medium text-gray-300">Lifecycle Steps</span>
            <div className="flex items-center gap-2">
              <Badge text={`${steps.length}/${TOTAL_STEPS} executed`} variant={steps.length === TOTAL_STEPS ? "success" : "default"} />
              <Badge text="SIMULATED" variant="medium" />
            </div>
          </CardHeader>
          <div className="p-4 space-y-1.5 max-h-[500px] overflow-y-auto">
            {steps.map((step) => (
              <div key={step.step} className={`flex items-start gap-3 p-2 rounded ${step.step === currentStep ? "bg-cyan-500/10 border border-cyan-500/30" : "bg-gray-800/30"}`}>
                <span className="text-[10px] text-gray-600 w-7 shrink-0">{step.step}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium ${actionColors[step.action] || "text-gray-400"}`}>{step.action}</span>
                    <span className="text-xs text-gray-300">{step.message}</span>
                    <Badge text={(step.source || "SIMULATED").toUpperCase()} variant="default" />
                  </div>
                  {(step.event_id || step.issue_id || step.incident_id) && (
                    <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {step.event_id && <span className="rounded bg-gray-800 px-1.5 py-0.5">Event {step.event_id}</span>}
                      {step.incident_id && <span className="rounded bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 text-red-400">Incident {step.incident_id} · {step.incident_status || "DETECTED"}</span>}
                      {step.issue_id && <span className="rounded bg-gray-800 px-1.5 py-0.5">Issue {step.issue_id} · {step.issue_status || "—"}</span>}
                    </div>
                  )}
                  {step.verification && (
                    <div className="text-[10px] text-green-500/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <Badge text="VERIFICATION" variant="success" />
                      <span>Result: {step.verification.result}</span>
                      <span>Clear: {step.verification.unique_clear_count}</span>
                      <span>Detected: {step.verification.unique_detected_count}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
