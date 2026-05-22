/* eslint-disable */
"use client";
import React, { useState, useEffect, useRef } from "react";

interface MaterialVerificationPanelProps {
  expectedEntity: string;       // e.g. "Salt"
  expectedYoloClass?: string;   // e.g. "bottle" — shown for operator awareness
  detectedObjects?: string[];   // from YOLO live state
  runId: string;
  onEventSent?: () => void;
}

type ScanState = "AWAITING" | "SCANNING" | "VERIFIED" | "MISMATCH" | "EXPIRED" | "UNREGISTERED" | "OBJECT_NOT_DETECTED";

interface ScanResult {
  uid: string;
  name?: string;
  batchNo?: string;
  yoloClass?: string;
  status: "ACTIVE" | "EXPIRED" | "UNREGISTERED";
  message: string;
}

const STATE_STYLE: Record<ScanState, { color: string; bg: string; border: string; label: string; icon: string }> = {
  AWAITING:             { color: "#565d75", bg: "#0d0f14", border: "#2a2f3d", label: "AWAITING NFC SCAN",        icon: "○" },
  SCANNING:             { color: "#f59e0b", bg: "#1a1200", border: "#4a3600", label: "READING TAG...",            icon: "◌" },
  VERIFIED:             { color: "#2dd4a0", bg: "#0a2620", border: "#1a4a38", label: "✓ VERIFIED",               icon: "✓" },
  MISMATCH:             { color: "#ef4444", bg: "#1a0808", border: "#6b2230", label: "✗ WRONG MATERIAL",         icon: "✗" },
  EXPIRED:              { color: "#f59e0b", bg: "#1a1200", border: "#7a4000", label: "⚠ EXPIRED BATCH",         icon: "⚠" },
  UNREGISTERED:         { color: "#8890a8", bg: "#0d0f14", border: "#2a2f3d", label: "? NOT REGISTERED",        icon: "?" },
  OBJECT_NOT_DETECTED:  { color: "#ef4444", bg: "#1a0808", border: "#6b2230", label: "✗ OBJECT NOT IN CAMERA",  icon: "📷" },
};

export default function MaterialVerificationPanel({
  expectedEntity, expectedYoloClass, detectedObjects = [], runId, onEventSent
}: MaterialVerificationPanelProps) {
  const [scanState, setScanState] = useState<ScanState>("AWAITING");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const processingRef = useRef(false);

  const containerDetected = expectedYoloClass
    ? detectedObjects.map(o => o.toLowerCase()).includes(expectedYoloClass.toLowerCase())
    : false;

  // ── Auto-poll NFC last-scan every 800ms ───────────────────────────────────────
  useEffect(() => {
    if (scanState === "VERIFIED") return; // stop polling once verified

    const interval = setInterval(async () => {
      if (processingRef.current) return;
      try {
        const r = await fetch("http://localhost:3000/api/hardware/last-scan");
        const data = await r.json();

        // Establish baseline on first check to ignore previous scans
        if (lastTimestampRef.current === 0) {
          if (data.timestamp) {
            lastTimestampRef.current = data.timestamp;
          } else {
            lastTimestampRef.current = 1;
          }
          return;
        }

        // Only process if this is a NEW scan (fresh timestamp)
        if (!data.uid || data.timestamp <= lastTimestampRef.current) return;
        lastTimestampRef.current = data.timestamp;

        processingRef.current = true;
        setScanState("SCANNING");

        // Look up the UID in inventory
        const scanRes = await fetch("http://localhost:3000/api/hardware/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: data.uid }),
        });
        const scanData: ScanResult = await scanRes.json();
        setScanResult(scanData);

        // ── Gate 1: check inventory status ──────────────────────────────
        if (scanData.status === "UNREGISTERED") {
          setScanState("UNREGISTERED");
          processingRef.current = false;
          return;
        }

        if (scanData.status === "EXPIRED") {
          setScanState("EXPIRED");
          await fetch(`http://localhost:3000/runs/${runId}/events`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "EXECUTE_STEP",
              payload: { verified_entity: scanData.name, success: false, nfc_uid: scanData.uid, status: "EXPIRED" }
            }),
          });
          onEventSent?.();
          processingRef.current = false;
          return;
        }

        // ── Gate 2: CV object presence check ────────────────────────────
        // Engine returns status: OBJECT_NOT_DETECTED when yoloClass not in frame
        if (scanData.status === "OBJECT_NOT_DETECTED") {
          setScanResult(scanData);  // show the engine's message to operator
          setScanState("OBJECT_NOT_DETECTED");
          processingRef.current = false;
          return;  // ← BLOCK: do NOT fire EXECUTE_STEP
        }

        // ── Gate 3: material name match ──────────────────────────────────
        const isMatch = scanData.name?.toLowerCase().trim() === expectedEntity.toLowerCase().trim();

        if (isMatch) {
          setScanState("VERIFIED");
          await fetch(`http://localhost:3000/runs/${runId}/events`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "EXECUTE_STEP",
              payload: {
                verified_entity: scanData.name,
                success: true,
                nfc_uid: scanData.uid,
                batch_no: scanData.batchNo,
                cv_check: scanData.cvCheckResult ?? "SKIPPED",
                yolo_container_detected: containerDetected,
                source: "NFC",
              }
            }),
          });
          onEventSent?.();
        } else {
          setScanState("MISMATCH");
        }

        processingRef.current = false;
      } catch (e) {
        setError("Backend offline — check sop-engine");
        processingRef.current = false;
      }
    }, 800);

    return () => clearInterval(interval);
  }, [scanState, expectedEntity, runId, containerDetected, onEventSent]);

  const retry = () => {
    setScanState("AWAITING");
    setScanResult(null);
    setError(null);
    processingRef.current = false;
  };

  const sc = STATE_STYLE[scanState];

  return (
    <div style={{ background: "#0e1117", border: "1px solid #1c2130", borderRadius: 10, padding: "18px 20px", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, fontWeight: 600, color: "#4b5563", letterSpacing: ".1em", textTransform: "uppercase" }}>NFC Verification</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#2dd4a0", background: "#0a2620", border: "1px solid #1a4a38", padding: "2px 7px", borderRadius: 3 }}>AUTO — NFC</span>
      </div>

      {/* Expected vs Scanned */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "#0d0f14", border: "1px solid #1c2130", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Expected</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 600, color: "#d4d8e8" }}>{expectedEntity || "—"}</div>
          {expectedYoloClass && (
            <div style={{ fontSize: 10, color: "#3a4055", marginTop: 4, fontFamily: "'IBM Plex Mono',monospace" }}>
              Container: <span style={{ color: containerDetected ? "#2dd4a0" : "#565d75" }}>{expectedYoloClass} {containerDetected ? "✓" : "○"}</span>
            </div>
          )}
        </div>
        <div style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: "#4b5563", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Scanned</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 16, fontWeight: 600, color: sc.color }}>{scanResult?.name ?? "—"}</div>
          {scanResult?.batchNo && (
            <div style={{ fontSize: 10, color: "#565d75", marginTop: 4, fontFamily: "'IBM Plex Mono',monospace" }}>Batch: {scanResult.batchNo}</div>
          )}
          {scanResult?.uid && (
            <div style={{ fontSize: 9, color: "#3a4055", marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>{scanResult.uid}</div>
          )}
        </div>
      </div>

      {/* Status banner */}
      <div style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18, color: sc.color, animation: scanState === "SCANNING" ? "spin .8s linear infinite" : "none" }}>{sc.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: sc.color, letterSpacing: ".06em" }}>{sc.label}</div>
          {scanResult?.message && <div style={{ fontSize: 11, color: "#8890a8", marginTop: 3 }}>{scanResult.message}</div>}
        </div>
      </div>

      {/* NFC waiting pulse */}
      {scanState === "AWAITING" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#090a0f", borderRadius: 6, border: "1px solid #1c2130" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2dd4a0", animation: "pulse-nfc 1.5s ease-in-out infinite" }} />
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: "#565d75" }}>
            Tap NFC tag on Arduino reader to verify material...
          </span>
        </div>
      )}

      {/* YOLO container corroboration */}
      {expectedYoloClass && scanState !== "AWAITING" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: containerDetected ? "#0a2620" : "#0d0f14", border: `1px solid ${containerDetected ? "#1a4a38" : "#1c2130"}`, borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: containerDetected ? "#2dd4a0" : "#3a4055" }}>{containerDetected ? "✓" : "○"}</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: containerDetected ? "#2dd4a0" : "#565d75" }}>
            YOLO: {expectedYoloClass} {containerDetected ? "detected in frame" : "not detected in frame"}
          </span>
        </div>
      )}

      {/* Retry on mismatch/unregistered/expired */}
      {(scanState === "MISMATCH" || scanState === "UNREGISTERED" || scanState === "EXPIRED" || scanState === "OBJECT_NOT_DETECTED") && (
        <button onClick={retry} style={{ background: "transparent", border: `1px solid ${sc.border}`, color: sc.color, borderRadius: 6, padding: "8px 0", fontSize: 11, cursor: "pointer", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: ".06em" }}>
          SCAN AGAIN
        </button>
      )}

      {error && <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "'IBM Plex Mono',monospace" }}>{error}</div>}

      <style>{`
        @keyframes pulse-nfc { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(0.8)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
