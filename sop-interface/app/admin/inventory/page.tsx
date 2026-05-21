"use client";

import { useState, useEffect, useRef } from "react";

export default function InventoryRegistrationPage() {
  const [formData, setFormData] = useState({
    nfcUid: "",
    name: "",
    batchNo: "",
    expiryDate: "",
  });
  const [status, setStatus] = useState({ type: "", message: "" });
  const [scanning, setScanning] = useState(false);
  const lastTimestampRef = useRef<number>(0);

  // ── Poll backend every 1.5s for a new NFC scan and auto-fill the UID field ──
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:3000/api/hardware/last-scan");
        const data = await res.json();
        if (
          data.uid &&
          data.timestamp > lastTimestampRef.current
        ) {
          lastTimestampRef.current = data.timestamp;
          setFormData((prev) => ({ ...prev, nfcUid: data.uid }));
          setScanning(true);
          setTimeout(() => setScanning(false), 2000);
        }
      } catch {
        // Fail silently — backend may not be running
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Saving to database..." });
    try {
      const response = await fetch("http://localhost:3000/api/inventory/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error("Failed to register item");
      setStatus({ type: "success", message: "✓ Item successfully linked to NFC Tag!" });
      setTimeout(() => setStatus({ type: "", message: "" }), 4000);
      setFormData({ nfcUid: "", name: "", batchNo: "", expiryDate: "" });
      lastTimestampRef.current = Date.now(); // Ignore already-seen scans after register
    } catch {
      setStatus({ type: "error", message: "✕ Error saving item. Check backend connection." });
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const page: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 16px",
    fontFamily: "'Inter', 'DM Sans', system-ui, sans-serif",
  };
  const card: React.CSSProperties = {
    background: "#ffffff",
    borderRadius: 16,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    border: "1px solid #e2e8f0",
    padding: "36px 40px",
    width: "100%",
    maxWidth: 560,
  };
  const heading: React.CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
    marginBottom: 6,
  };
  const subtext: React.CSSProperties = {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 28,
  };
  const fieldGroup: React.CSSProperties = { marginBottom: 20 };
  const label: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
  };
  const labelHint: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 400,
    color: "#94a3b8",
    marginLeft: 6,
  };
  const input: React.CSSProperties = {
    width: "100%",
    border: "1.5px solid #cbd5e1",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 14,
    color: "#0f172a",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color .15s",
  };
  const inputScanning: React.CSSProperties = {
    ...input,
    borderColor: "#10b981",
    boxShadow: "0 0 0 3px rgba(16,185,129,0.15)",
    background: "#f0fdf4",
    color: "#065f46",
    fontWeight: 600,
  };
  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 20,
  };
  const scanBadge: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#15803d",
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: 999,
    marginLeft: 8,
  };
  const btn: React.CSSProperties = {
    width: "100%",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 15,
    padding: "13px 0",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    marginTop: 8,
    transition: "background .15s",
  };
  const statusBox = (type: string): React.CSSProperties => ({
    marginTop: 20,
    padding: "12px 16px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    color: type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#1d4ed8",
    background: type === "error" ? "#fef2f2" : type === "success" ? "#f0fdf4" : "#eff6ff",
    border: `1px solid ${type === "error" ? "#fecaca" : type === "success" ? "#bbf7d0" : "#bfdbfe"}`,
  });

  return (
    <div style={page}>
      <div style={card}>
        <h1 style={heading}>Inventory Registration</h1>
        <p style={subtext}>Link a physical NFC tag to a new database material.</p>

        <form onSubmit={handleSubmit}>
          {/* NFC UID */}
          <div style={fieldGroup}>
            <label style={label}>
              NFC Tag UID
              <span style={labelHint}>(Hold tag near reader to auto-fill)</span>
              {scanning && <span style={scanBadge}>⚡ Tag Detected!</span>}
            </label>
            <input
              type="text"
              required
              value={formData.nfcUid}
              onChange={(e) => setFormData({ ...formData, nfcUid: e.target.value })}
              style={scanning ? inputScanning : input}
              placeholder="e.g., 6FDAABDD"
            />
          </div>

          {/* Material Name */}
          <div style={fieldGroup}>
            <label style={label}>Material Name</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={input}
              placeholder="e.g., Base Alcohol 90%"
            />
          </div>

          {/* Batch + Expiry */}
          <div style={grid}>
            <div>
              <label style={label}>Batch Number <span style={labelHint}>(Optional)</span></label>
              <input
                type="text"
                value={formData.batchNo}
                onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
                style={input}
                placeholder="e.g., BATCH-1042"
              />
            </div>
            <div>
              <label style={label}>Expiry Date <span style={labelHint}>(Optional)</span></label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                style={input}
              />
            </div>
          </div>

          <button type="submit" style={btn}>
            Register Product
          </button>
        </form>

        {status.message && (
          <div style={statusBox(status.type)}>{status.message}</div>
        )}
      </div>
    </div>
  );
}
