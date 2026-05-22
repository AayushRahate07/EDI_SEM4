/* eslint-disable */
"use client";
import React, { useState, useEffect } from "react";

interface WeightState {
  currentWeight: number | null;
  initialWeight: number | null;
  unit: string;
  ocrConfidence: number;
  updatedAt?: string;
}
interface WeightMonitorPanelProps {
  targetValue: number;           // amount to ADD (delta target)
  tolerancePositive: number;
  toleranceNegative: number;
  unit: string;
  weightState: WeightState;
  runId: string;
  onEventSent?: () => void;
  lastFinalWeight?: number | null;
  detectedObjects: string[];
  processActivity: string;
  targetYoloClass?: string | null;
}

export default function WeightMonitorPanel({
  targetValue, tolerancePositive, toleranceNegative, unit, weightState, runId, onEventSent, lastFinalWeight, detectedObjects, processActivity, targetYoloClass
}: WeightMonitorPanelProps) {
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [captured, setCaptured]         = useState(false);

  // Separate manual inputs for initial and final weights
  const [manualInitial, setManualInitial] = useState("");
  const [manualFinal,   setManualFinal]   = useState("");

  // Keep track of the first non-null scale reading when the step started (if no previous step weight is available)
  const [firstScaleReading, setFirstScaleReading] = useState<number | null>(null);

  useEffect(() => {
    if (firstScaleReading === null && weightState.currentWeight !== null) {
      setFirstScaleReading(weightState.currentWeight);
    }
  }, [weightState.currentWeight, firstScaleReading]);

  // Resolve values: manual overrides OCR / last final weight / first scale reading
  const initialWeight: number | null =
    manualInitial !== "" && !isNaN(parseFloat(manualInitial))
      ? parseFloat(manualInitial)
      : (lastFinalWeight !== undefined && lastFinalWeight !== null)
        ? lastFinalWeight
        : (weightState.initialWeight !== null ? weightState.initialWeight : firstScaleReading);

  const finalWeight: number | null =
    manualFinal !== "" && !isNaN(parseFloat(manualFinal))
      ? parseFloat(manualFinal)
      : weightState.currentWeight;

  const delta: number | null =
    initialWeight !== null && finalWeight !== null
      ? parseFloat((finalWeight - initialWeight).toFixed(4))
      : null;

  const lowerBound = parseFloat((targetValue - toleranceNegative).toFixed(4));
  const upperBound = parseFloat((targetValue + tolerancePositive).toFixed(4));

  const passCheck: boolean | null =
    delta !== null ? delta >= lowerBound && delta <= upperBound : null;

  const fmt = (w: number | null) => w !== null ? `${w.toFixed(2)}${unit}` : "—";
  const fmtDelta = (d: number | null) =>
    d !== null ? `${d >= 0 ? "+" : ""}${d.toFixed(2)}${unit}` : "—";

  const ocrConf       = weightState.ocrConfidence ?? 0;
  const confColor     = ocrConf >= 90 ? "#2dd4a0" : ocrConf >= 70 ? "#f59e0b" : "#ef4444";
  const isManualMode  = manualInitial !== "" || manualFinal !== "";

  // ── Interaction Lock Logic ──────────────────────────────────────────────────
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    if (hasInteracted) return;

    // Check 1: Is the target container (or any general container) currently detected in YOLO frame?
    const containerClasses = ["bottle", "cup", "bowl", "vase", "handbag"];
    const targetMatch = targetYoloClass ? detectedObjects.some(obj => obj.toLowerCase() === targetYoloClass.toLowerCase()) : false;
    const anyContainerMatch = detectedObjects.some(obj => containerClasses.includes(obj.toLowerCase()));

    // Check 2: Is active weighing/handling activity detected?
    const activeActivity = ["WEIGHING", "POURING_LIKELY", "HANDLING_MATERIAL"].includes(processActivity);

    // Check 3: Has the weight actually changed significantly (absolute delta > 0.05)?
    const weightChanged = delta !== null && Math.abs(delta) >= 0.05;

    if (targetMatch || anyContainerMatch || activeActivity || weightChanged) {
      setHasInteracted(true);
    }
  }, [detectedObjects, processActivity, delta, targetYoloClass, hasInteracted]);

  const handleCapture = async () => {
    if (delta === null || isNaN(delta) || !hasInteracted) return;
    setLoading(true); setError(null);
    try {
      await fetch(`http://localhost:3000/runs/${runId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "EXECUTE_STEP",
          payload: {
            delta,                        // amount added — validated by engine
            value: finalWeight,           // final absolute reading for audit
            initial_weight: initialWeight,
            final_weight: finalWeight,
          }
        }),
      });
      setCaptured(true);
      onEventSent?.();
    } catch { setError("Failed to send to backend."); }
    finally { setLoading(false); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const passColor   = "#2dd4a0";
  const failColor   = "#ef4444";
  const neutralColor = "#d4d8e8";

  return (
    <div style={{ background: "#0e1117", border: "1px solid #1c2130", borderRadius: 10, padding: "18px 20px", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, color: "#4b5563", letterSpacing: ".1em", textTransform: "uppercase" }}>Weight Monitor</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: isManualMode ? "#f59e0b" : "#4da6ff", background: isManualMode ? "#1a1200" : "#0a1830", border: `1px solid ${isManualMode ? "#4a3600" : "#1a3060"}`, padding: "2px 7px", borderRadius: 3 }}>
          {isManualMode ? "MANUAL OVERRIDE" : "LIVE OCR"}
        </span>
      </div>

      {/* ── INTERACTION GATE ALERT ────────────────────────────────────────────── */}
      {!hasInteracted ? (
        <div style={{
          background: "rgba(245, 158, 11, 0.04)",
          border: "1px dashed #f59e0b",
          borderRadius: 8,
          padding: "16px 20px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 24, animation: "bounce 1.5s infinite" }}>🔒</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#fbbf24", fontWeight: 600, letterSpacing: ".04em" }}>
            AWAITING CONTAINER INTERACTION
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af", maxWidth: 320, lineHeight: 1.5 }}>
            Please place or pour from the verified container (<strong>{targetYoloClass || "bottle"}</strong>) on the scale workstation to unlock weight submission.
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#6b7280", background: "#161922", padding: "3px 6px", borderRadius: 4 }}>
              Activity: {processActivity}
            </span>
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#6b7280", background: "#161922", padding: "3px 6px", borderRadius: 4 }}>
              Objects: {detectedObjects.length > 0 ? detectedObjects.join(", ") : "none"}
            </span>
          </div>
        </div>
      ) : (
        <div style={{
          background: "rgba(16, 185, 129, 0.04)",
          border: "1px solid #10b981",
          borderRadius: 8,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 16, color: "#10b981" }}>🔓</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, color: "#2dd4a0", letterSpacing: ".06em" }}>
            INTERACTION VERIFIED — WEIGHT SUBMISSION UNLOCKED
          </span>
        </div>
      )}

      {/* ── Two-column: Initial | Final ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, opacity: hasInteracted ? 1 : 0.4, pointerEvents: hasInteracted ? "auto" : "none", transition: "opacity 0.3s" }}>

        {/* Initial weight */}
        <div style={{ background: "#090a0f", border: "1px solid #1c2130", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em" }}>Initial Weight</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 28, fontWeight: 700, color: "#8890a8", letterSpacing: ".04em" }}>
            {fmt(initialWeight)}
          </div>
          <input
            id="initial-weight-input"
            type="number" step="0.01"
            value={manualInitial}
            placeholder="Override…"
            disabled={!hasInteracted}
            onChange={e => { setManualInitial(e.target.value); setCaptured(false); }}
            style={{ background: "#161922", border: "1px solid #242936", borderRadius: 5, padding: "5px 9px", fontSize: 12, color: "#d4d8e8", fontFamily: "'IBM Plex Mono',monospace", outline: "none", width: "100%", boxSizing: "border-box" }}
          />
        </div>

        {/* Final weight */}
        <div style={{ background: "#090a0f", border: "1px solid #1c2130", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em" }}>Final Weight</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 28, fontWeight: 700, color: "#d4d8e8", letterSpacing: ".04em" }}>
            {fmt(finalWeight)}
          </div>
          <input
            id="final-weight-input"
            type="number" step="0.01"
            value={manualFinal}
            placeholder="Override…"
            disabled={!hasInteracted}
            onChange={e => { setManualFinal(e.target.value); setCaptured(false); }}
            style={{ background: "#161922", border: "1px solid #242936", borderRadius: 5, padding: "5px 9px", fontSize: 12, color: "#d4d8e8", fontFamily: "'IBM Plex Mono',monospace", outline: "none", width: "100%", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* ── Delta (amount added) — hero display ────────────────────────────────── */}
      <div style={{ background: "#090a0f", border: `1px solid ${passCheck === true ? "#1a4a38" : passCheck === false ? "#6b2230" : "#1c2130"}`, borderRadius: 8, padding: "18px 20px", textAlign: "center", opacity: hasInteracted ? 1 : 0.4, transition: "opacity 0.3s" }}>
        <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Amount Added</div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 42, fontWeight: 700, color: passCheck === true ? passColor : passCheck === false ? failColor : neutralColor, letterSpacing: ".06em", transition: "color 0.3s" }}>
          {fmtDelta(delta)}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "#565d75", fontFamily: "'IBM Plex Mono',monospace" }}>
          Target: <span style={{ color: "#8890a8" }}>+{targetValue}{unit}</span>
          &nbsp;·&nbsp;
          Range: <span style={{ color: "#8890a8" }}>{lowerBound}–{upperBound}{unit}</span>
        </div>
      </div>

      {/* ── Metrics grid ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, opacity: hasInteracted ? 1 : 0.4, transition: "opacity 0.3s" }}>
        {[
          { l: "Lower",     v: `+${lowerBound}${unit}`,  c: "#565d75" },
          { l: "Upper",     v: `+${upperBound}${unit}`,  c: "#565d75" },
          { l: "Tolerance", v: `±${tolerancePositive}${unit}`, c: "#8890a8" },
        ].map(m => (
          <div key={m.l} style={{ background: "#0d0f14", border: "1px solid #1c2130", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>{m.l}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 600, color: m.c }}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* OCR confidence bar */}
      {ocrConf > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase" }}>OCR Confidence</span>
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: confColor }}>{ocrConf}%</span>
          </div>
          <div style={{ height: 4, background: "#1c2130", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${ocrConf}%`, background: confColor, borderRadius: 2, transition: "width 0.3s ease" }} />
          </div>
        </div>
      )}

      {/* Pass/fail banner */}
      {passCheck !== null && hasInteracted && (
        <div style={{ background: passCheck ? "#0a2620" : "#1a0808", border: `1px solid ${passCheck ? "#1a4a38" : "#6b2230"}`, borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, color: passCheck ? passColor : failColor }}>{passCheck ? "✓" : "✗"}</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: passCheck ? passColor : failColor, letterSpacing: ".06em" }}>
            {passCheck ? `WITHIN TOLERANCE — PASS  (added ${fmtDelta(delta)})` : `OUT OF RANGE — FAIL  (added ${fmtDelta(delta)}, need +${lowerBound}–+${upperBound}${unit})`}
          </span>
        </div>
      )}

      {/* Live scale feed */}
      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid #1c2130", background: "#060810" }}>
        <div style={{ padding: "6px 10px", background: "#090a0f", borderBottom: "1px solid #1c2130", fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase" }}>Live Scale Feed</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="http://localhost:8001/video_feed" alt="Scale live feed" style={{ width: "100%", display: "block", maxHeight: 280, objectFit: "contain", background: "#000" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>

      {/* Submit button */}
      {!captured ? (
        <button
          id="capture-weight-btn"
          onClick={handleCapture}
          disabled={loading || delta === null || isNaN(delta) || !hasInteracted}
          style={{ background: "linear-gradient(135deg,#0a1830 0%,#0a2620 100%)", border: `1px solid ${hasInteracted ? "#10b981" : "#4b5563"}`, color: hasInteracted ? "#2dd4a0" : "#6b7280", borderRadius: 6, padding: "11px 0", fontSize: 11, fontWeight: 600, cursor: hasInteracted ? "pointer" : "not-allowed", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: ".08em", textTransform: "uppercase", opacity: (loading || delta === null || isNaN(delta) || !hasInteracted) ? 0.4 : 1 }}
        >
          {loading ? "Sending…" : !hasInteracted ? "🔒 Awaiting Interaction" : `Submit Added: ${fmtDelta(delta)} → Engine`}
        </button>
      ) : (
        <div style={{ background: "#0a2620", border: "1px solid #1a4a38", borderRadius: 6, padding: "10px 0", textAlign: "center", fontSize: 11, color: "#2dd4a0", fontFamily: "'IBM Plex Mono',monospace" }}>
          ✓ Reading submitted — awaiting engine validation
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "'IBM Plex Mono',monospace" }}>{error}</div>}
    </div>
  );
}
