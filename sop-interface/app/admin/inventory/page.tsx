"use client";

import { useState, useEffect, useRef } from "react";

type InventoryItem = {
  id: string;
  nfcUid: string;
  name: string;
  batchNo: string | null;
  expiryDate: string | null;
  yoloClass: string | null;
  createdAt: string;
};

const YOLO_OPTIONS = [
  { value: "", label: "-- Select Container Type --" },
  { value: "bottle", label: "Bottle" },
  { value: "cup", label: "Cup / Beaker" },
  { value: "bowl", label: "Bowl / Mortar" },
  { value: "vase", label: "Flask / Vase" },
  { value: "wine glass", label: "Volumetric Flask" },
];

export default function InventoryRegistrationPage() {
  const [formData, setFormData] = useState({
    nfcUid: "",
    name: "",
    batchNo: "",
    expiryDate: "",
    yoloClass: "",
  });
  const [status, setStatus] = useState({ type: "", message: "" });
  const [scanning, setScanning] = useState(false);
  const lastTimestampRef = useRef<number>(0);

  // ── Inventory list state ──────────────────────────────────────────────────
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // ── Edit modal state ──────────────────────────────────────────────────────
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    batchNo: "",
    expiryDate: "",
    yoloClass: "",
  });
  const [editStatus, setEditStatus] = useState({ type: "", message: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Delete confirm state ──────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch inventory list ──────────────────────────────────────────────────
  const fetchItems = async () => {
    setLoadingList(true);
    try {
      const res = await fetch("http://localhost:3000/api/inventory");
      if (res.ok) setItems(await res.json());
    } catch {}
    setLoadingList(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  // ── Poll for NFC scans ────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:3000/api/hardware/last-scan");
        const data = await res.json();
        if (data.uid && data.timestamp > lastTimestampRef.current) {
          lastTimestampRef.current = data.timestamp;
          setFormData((prev) => ({ ...prev, nfcUid: data.uid }));
          setScanning(true);
          setTimeout(() => setScanning(false), 2000);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // ── Register new item ─────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Saving to database..." });
    try {
      const response = await fetch("http://localhost:3000/api/inventory/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!response.ok) {
        let errMsg = "Failed to register item. Check backend connection.";
        try {
          const errData = await response.json();
          if (errData?.message) errMsg = errData.message;
        } catch {}
        setStatus({ type: "error", message: `✕ ${errMsg}` });
        return;
      }
      setStatus({ type: "success", message: "✓ Item successfully linked to NFC Tag!" });
      setTimeout(() => setStatus({ type: "", message: "" }), 4000);
      setFormData({ nfcUid: "", name: "", batchNo: "", expiryDate: "", yoloClass: "" });
      lastTimestampRef.current = Date.now();
      fetchItems();
    } catch {
      setStatus({ type: "error", message: "✕ Cannot reach backend. Is sop-engine running?" });
    }
  };

  // ── Open edit modal ───────────────────────────────────────────────────────
  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setEditForm({
      name: item.name,
      batchNo: item.batchNo ?? "",
      expiryDate: item.expiryDate ? item.expiryDate.split("T")[0] : "",
      yoloClass: item.yoloClass ?? "",
    });
    setEditStatus({ type: "", message: "" });
  };

  // ── Save edit ─────────────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editItem) return;
    setSavingEdit(true);
    setEditStatus({ type: "loading", message: "Saving..." });
    try {
      const response = await fetch(`http://localhost:3000/api/inventory/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!response.ok) {
        let errMsg = "Failed to save changes.";
        try {
          const errData = await response.json();
          if (errData?.message) errMsg = errData.message;
        } catch {}
        setEditStatus({ type: "error", message: `✕ ${errMsg}` });
      } else {
        setEditStatus({ type: "success", message: "✓ Saved!" });
        fetchItems();
        setTimeout(() => setEditItem(null), 800);
      }
    } catch {
      setEditStatus({ type: "error", message: "✕ Cannot reach backend." });
    }
    setSavingEdit(false);
  };

  // ── Delete item ───────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await fetch(`http://localhost:3000/api/inventory/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
    } catch {}
    setDeletingId(null);
    setDeleteTarget(null);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const isExpired = (d: string | null) => d ? new Date(d) < new Date() : false;

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    page: { minHeight: "100vh", background: "#f1f5f9", padding: "32px 16px", fontFamily: "'Inter', system-ui, sans-serif" } as React.CSSProperties,
    wrap: { maxWidth: 900, margin: "0 auto" } as React.CSSProperties,
    card: { background: "#fff", borderRadius: 16, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0", padding: "36px 40px", marginBottom: 32 } as React.CSSProperties,
    heading: { fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0, marginBottom: 4 } as React.CSSProperties,
    subtext: { fontSize: 13, color: "#64748b", marginBottom: 28 } as React.CSSProperties,
    label: { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 } as React.CSSProperties,
    labelHint: { fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 6 } as React.CSSProperties,
    input: { width: "100%", border: "1.5px solid #cbd5e1", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#0f172a", background: "#fff", outline: "none", boxSizing: "border-box" as const },
    inputScanning: { width: "100%", border: "1.5px solid #10b981", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#065f46", background: "#f0fdf4", outline: "none", boxSizing: "border-box" as const, fontWeight: 600 },
    fieldGroup: { marginBottom: 20 } as React.CSSProperties,
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 } as React.CSSProperties,
    btn: { background: "#2563eb", color: "#fff", fontWeight: 700, fontSize: 15, padding: "13px 0", border: "none", borderRadius: 8, cursor: "pointer", width: "100%" } as React.CSSProperties,
    scanBadge: { display: "inline-flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, marginLeft: 8 } as React.CSSProperties,
    statusBox: (type: string): React.CSSProperties => ({
      marginTop: 20, padding: "12px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500,
      color: type === "error" ? "#b91c1c" : type === "success" ? "#15803d" : "#1d4ed8",
      background: type === "error" ? "#fef2f2" : type === "success" ? "#f0fdf4" : "#eff6ff",
      border: `1px solid ${type === "error" ? "#fecaca" : type === "success" ? "#bbf7d0" : "#bfdbfe"}`,
    }),

    // Table
    tableWrap: { overflowX: "auto" as const },
    table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
    th: { textAlign: "left" as const, padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "2px solid #e2e8f0", background: "#f8fafc" },
    td: { padding: "12px 14px", borderBottom: "1px solid #f1f5f9", color: "#0f172a", verticalAlign: "middle" as const },
    uid: { fontFamily: "monospace", fontSize: 12, background: "#f1f5f9", padding: "2px 8px", borderRadius: 4, color: "#475569" } as React.CSSProperties,
    expiredBadge: { display: "inline-block", background: "#fef2f2", color: "#b91c1c", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, border: "1px solid #fecaca", marginLeft: 6 } as React.CSSProperties,
    iconBtn: (color: string): React.CSSProperties => ({ background: "none", border: `1.5px solid ${color}`, color, borderRadius: 7, padding: "5px 10px", fontSize: 13, cursor: "pointer", fontWeight: 600, transition: "all .15s" }),

    // Modal overlay
    overlay: { position: "fixed" as const, inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
    modal: { background: "#fff", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", padding: "36px 40px", width: "100%", maxWidth: 480 } as React.CSSProperties,
    modalHeading: { fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 4 } as React.CSSProperties,
    modalSub: { fontSize: 13, color: "#64748b", marginBottom: 24 } as React.CSSProperties,
    modalActions: { display: "flex", gap: 12, marginTop: 24 } as React.CSSProperties,
    cancelBtn: { flex: 1, background: "#f1f5f9", color: "#374151", fontWeight: 600, fontSize: 14, padding: "11px 0", border: "none", borderRadius: 8, cursor: "pointer" } as React.CSSProperties,
    saveBtn: { flex: 2, background: "#2563eb", color: "#fff", fontWeight: 700, fontSize: 14, padding: "11px 0", border: "none", borderRadius: 8, cursor: "pointer" } as React.CSSProperties,
    deleteBtn: { flex: 2, background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 14, padding: "11px 0", border: "none", borderRadius: 8, cursor: "pointer" } as React.CSSProperties,
  };

  return (
    <div style={S.page}>
      <div style={S.wrap}>

        {/* ── Registration Form ── */}
        <div style={S.card}>
          <h1 style={S.heading}>Inventory Registration</h1>
          <p style={S.subtext}>Link a physical NFC tag to a new database material.</p>

          <form onSubmit={handleSubmit}>
            <div style={S.fieldGroup}>
              <label style={S.label}>
                NFC Tag UID
                <span style={S.labelHint}>(Hold tag near reader to auto-fill)</span>
                {scanning && <span style={S.scanBadge}>⚡ Tag Detected!</span>}
              </label>
              <input
                type="text" required
                value={formData.nfcUid}
                onChange={(e) => setFormData({ ...formData, nfcUid: e.target.value })}
                style={scanning ? S.inputScanning : S.input}
                placeholder="e.g., 6FDAABDD"
              />
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>Material Name</label>
              <input
                type="text" required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={S.input}
                placeholder="e.g., Base Alcohol 90%"
              />
            </div>

            <div style={S.grid}>
              <div>
                <label style={S.label}>Batch Number <span style={S.labelHint}>(Optional)</span></label>
                <input type="text" value={formData.batchNo}
                  onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
                  style={S.input} placeholder="e.g., BATCH-1042" />
              </div>
              <div>
                <label style={S.label}>Expiry Date <span style={S.labelHint}>(Optional)</span></label>
                <input type="date" value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  style={S.input} />
              </div>
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>YOLO Container Class
                <span style={S.labelHint}>(What YOLO should detect for this container)</span>
              </label>
              <select value={formData.yoloClass}
                onChange={(e) => setFormData({ ...formData, yoloClass: e.target.value })}
                style={S.input}>
                {YOLO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
                YOLO will confirm this container type is visible during NFC verification.
              </div>
            </div>

            <button type="submit" style={S.btn}>Register Product</button>
          </form>

          {status.message && <div style={S.statusBox(status.type)}>{status.message}</div>}
        </div>

        {/* ── Registered Inventory List ── */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ ...S.heading, fontSize: 18 }}>Registered Inventory</h2>
              <p style={{ ...S.subtext, marginBottom: 0 }}>{items.length} item{items.length !== 1 ? "s" : ""} registered</p>
            </div>
            <button onClick={fetchItems} style={{ ...S.iconBtn("#64748b"), fontSize: 12 }}>↻ Refresh</button>
          </div>

          {loadingList ? (
            <div style={{ color: "#94a3b8", fontSize: 14, padding: "20px 0" }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 14, padding: "24px 0", textAlign: "center" }}>
              No items registered yet. Register your first NFC tag above.
            </div>
          ) : (
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Material</th>
                    <th style={S.th}>NFC UID</th>
                    <th style={S.th}>Batch</th>
                    <th style={S.th}>Expiry</th>
                    <th style={S.th}>YOLO Class</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ background: isExpired(item.expiryDate) ? "#fffbeb" : "transparent" }}>
                      <td style={S.td}>
                        <span style={{ fontWeight: 600 }}>{item.name}</span>
                        {isExpired(item.expiryDate) && <span style={S.expiredBadge}>EXPIRED</span>}
                      </td>
                      <td style={S.td}><span style={S.uid}>{item.nfcUid}</span></td>
                      <td style={S.td}>{item.batchNo ?? <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ ...S.td, color: isExpired(item.expiryDate) ? "#b91c1c" : "#0f172a" }}>
                        {formatDate(item.expiryDate)}
                      </td>
                      <td style={S.td}>
                        {item.yoloClass
                          ? <span style={{ fontFamily: "monospace", fontSize: 12, background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: 4 }}>{item.yoloClass}</span>
                          : <span style={{ color: "#cbd5e1" }}>—</span>}
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" as const }}>
                        <button style={S.iconBtn("#2563eb")} onClick={() => openEdit(item)}>✏ Edit</button>
                        {" "}
                        <button style={S.iconBtn("#dc2626")} onClick={() => setDeleteTarget(item)}
                          disabled={deletingId === item.id}>
                          {deletingId === item.id ? "…" : "🗑 Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editItem && (
        <div style={S.overlay} onClick={() => setEditItem(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={S.modalHeading}>Edit Item</h2>
            <p style={S.modalSub}>
              <span style={S.uid}>{editItem.nfcUid}</span>
              {" "}— NFC UID cannot be changed.
            </p>

            <div style={S.fieldGroup}>
              <label style={S.label}>Material Name</label>
              <input type="text" value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={S.input} />
            </div>

            <div style={S.grid}>
              <div>
                <label style={S.label}>Batch Number</label>
                <input type="text" value={editForm.batchNo}
                  onChange={(e) => setEditForm({ ...editForm, batchNo: e.target.value })}
                  style={S.input} placeholder="e.g., BATCH-1042" />
              </div>
              <div>
                <label style={S.label}>Expiry Date</label>
                <input type="date" value={editForm.expiryDate}
                  onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })}
                  style={S.input} />
              </div>
            </div>

            <div style={S.fieldGroup}>
              <label style={S.label}>YOLO Container Class</label>
              <select value={editForm.yoloClass}
                onChange={(e) => setEditForm({ ...editForm, yoloClass: e.target.value })}
                style={S.input}>
                {YOLO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {editStatus.message && <div style={S.statusBox(editStatus.type)}>{editStatus.message}</div>}

            <div style={S.modalActions}>
              <button style={S.cancelBtn} onClick={() => setEditItem(null)}>Cancel</button>
              <button style={S.saveBtn} onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && (
        <div style={S.overlay} onClick={() => setDeleteTarget(null)}>
          <div style={{ ...S.modal, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ ...S.modalHeading, color: "#dc2626" }}>Delete Item?</h2>
            <p style={{ ...S.modalSub, marginBottom: 16 }}>
              This will permanently remove <strong>{deleteTarget.name}</strong>
              {" "}(<span style={S.uid}>{deleteTarget.nfcUid}</span>) from the inventory.
              This cannot be undone.
            </p>
            <div style={S.modalActions}>
              <button style={S.cancelBtn} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button style={S.deleteBtn} onClick={confirmDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
