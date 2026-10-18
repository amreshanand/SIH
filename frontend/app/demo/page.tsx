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

const actionBadgeVariant: Record<string, string> = {
  EVENT: "warning",
  STATUS: "info",
  ASSIGN: "info",
  STATUS_UPDATE: "info",
  VERIFY: "success",
  INCIDENT: "critical",
  NOTIFICATION: "warning",
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
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Operations Simulation & Validation
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-800 tracking-wide">
              SIMULATION / DEMO HARNESS
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Lifecycle Verification Harness
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Step-by-step verification of municipal issue progression: Detection → Verification → Assignment → Work In Progress → Audit → Resolution → Reopen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge text={running ? "EXECUTING STEP" : "HARNESS READY"} variant={running ? "warning" : "success"} />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs font-mono">
          {error}
        </div>
      )}

      {/* SIH Mode Banner */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-sm font-bold text-slate-900">Automated Sequence — End-to-End Simulation</div>
          <div className="text-xs text-slate-600 mt-0.5">
            Initializes isolated mock data and executes all {TOTAL_STEPS} municipal workflow steps sequentially with consensus verification.
          </div>
        </div>
        <button
          onClick={handleSihMode}
          disabled={running}
          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded text-xs hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
        >
          {running ? "EXECUTING SIMULATION..." : "RUN FULL SIMULATION SEQUENCE"}
        </button>
      </div>

      {/* Metric & Control Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Data Status */}
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Harness State</span>
            <Badge text="SIMULATED" variant="medium" />
          </CardHeader>
          <div className="p-4 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Simulated Transit Units</span>
              <span className="font-semibold text-slate-900 font-mono">{demoStatus?.buses ?? 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Edge Detection Events</span>
              <span className="font-semibold text-slate-900 font-mono">{demoStatus?.events ?? 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Aggregated Municipal Issues</span>
              <span className="font-semibold text-slate-900 font-mono">{demoStatus?.issues ?? 0}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Traffic Incidents</span>
              <span className="font-semibold text-slate-900 font-mono">{demoStatus?.incidents ?? 0}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Workflow Steps Total</span>
              <span className="font-semibold text-slate-900 font-mono">{TOTAL_STEPS}</span>
            </div>
          </div>
        </Card>

        {/* Step Controls */}
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Step Controls</span>
            <span className="text-[10px] font-mono text-slate-500">STEP {currentStep} / {TOTAL_STEPS}</span>
          </CardHeader>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleStep.bind(null, 1)}
                disabled={running || currentStep >= 1}
                className="px-3 py-2 bg-white border border-slate-300 rounded text-slate-700 font-medium text-xs hover:bg-slate-50 disabled:opacity-40"
              >
                START (STEP 1)
              </button>
              <button
                onClick={handleNext}
                disabled={running || currentStep === 0 || currentStep >= TOTAL_STEPS}
                className="px-3 py-2 bg-blue-600 text-white rounded font-medium text-xs hover:bg-blue-700 disabled:opacity-40"
              >
                NEXT STEP
              </button>
              <button
                onClick={handleFastForward}
                disabled={running}
                className="px-3 py-2 bg-white border border-slate-300 rounded text-slate-700 font-medium text-xs hover:bg-slate-50 disabled:opacity-40"
              >
                FAST-FORWARD
              </button>
              <button
                onClick={handleSeed}
                disabled={running}
                className="px-3 py-2 bg-white border border-slate-300 rounded text-slate-700 font-medium text-xs hover:bg-slate-50 disabled:opacity-40"
              >
                SEED DATA
              </button>
              <button
                onClick={handleReset}
                disabled={running}
                className="col-span-2 px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 font-medium rounded text-xs hover:bg-rose-100 disabled:opacity-40"
              >
                RESET SIMULATION
              </button>
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                <span>Execution Progress</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </Card>

        {/* Live WebSocket Status */}
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">WebSocket Ingestion</span>
            <Badge text={connected ? "CONNECTED" : "DISCONNECTED"} variant={connected ? "success" : "warning"} />
          </CardHeader>
          <div className="p-4 space-y-2">
            {messagesKeyed.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center italic">
                Awaiting telemetry / event frames from backend...
              </p>
            )}
            {messagesKeyed.map((m, i) => (
              <div key={i} className="p-2 bg-slate-50 border border-slate-200 rounded text-xs flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-900 font-mono">
                    {typeof m.type === "string" ? m.type : "event"}
                  </span>
                  {typeof m.step === "number" && (
                    <span className="text-slate-500 ml-1.5 font-mono">step {m.step}</span>
                  )}
                </div>
                <Badge text="SIMULATED" variant="medium" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Step Log Table */}
      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Executed Sequence Ledger</span>
              <Badge text={`${steps.length}/${TOTAL_STEPS} EXECUTED`} variant={steps.length === TOTAL_STEPS ? "success" : "info"} />
            </div>
            <Badge text="SIMULATION AUDIT" variant="medium" />
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2.5 px-4 w-14 font-mono">Step</th>
                  <th className="py-2.5 px-4 w-28">Action</th>
                  <th className="py-2.5 px-4">Message / Description</th>
                  <th className="py-2.5 px-4 w-40">Entity Link</th>
                  <th className="py-2.5 px-4 w-48">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {steps.map((step) => {
                  const isCurrent = step.step === currentStep;
                  return (
                    <tr key={step.step} className={isCurrent ? "bg-blue-50/50 font-medium" : "hover:bg-slate-50/50"}>
                      <td className="py-2.5 px-4 font-mono text-slate-500">#{step.step}</td>
                      <td className="py-2.5 px-4">
                        <Badge text={step.action} variant={actionBadgeVariant[step.action] || "default"} />
                      </td>
                      <td className="py-2.5 px-4 text-slate-800">{step.message}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                        {step.issue_id && (
                          <span className="inline-block px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded mr-1">
                            Issue: {step.issue_id.slice(0, 8)}
                          </span>
                        )}
                        {step.incident_id && (
                          <span className="inline-block px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded">
                            Inc: {step.incident_id.slice(0, 8)}
                          </span>
                        )}
                        {!step.issue_id && !step.incident_id && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-[11px]">
                        {step.verification ? (
                          <span className="text-emerald-700 font-medium">
                            {step.verification.result || "Verified"} (clear: {step.verification.unique_clear_count}, det: {step.verification.unique_detected_count})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
