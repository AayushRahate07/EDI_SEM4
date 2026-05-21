"use client";

import { useState } from "react";

export default function InventoryRegistrationPage() {
  const [formData, setFormData] = useState({
    nfcUid: "",
    name: "",
    batchNo: "",
    expiryDate: "",
  });
  const [status, setStatus] = useState({ type: "", message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: "loading", message: "Saving to database..." });

    try {
      // Note: Assuming NestJS backend is running on port 3001
      const response = await fetch("http://localhost:3000/api/inventory/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error("Failed to register item");

      setStatus({ type: "success", message: "Item successfully linked to NFC Tag!" });
      setFormData({ nfcUid: "", name: "", batchNo: "", expiryDate: "" });
    } catch (error) {
      setStatus({ type: "error", message: "Error saving item. Check backend connection." });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-200">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Inventory Registration</h1>
        <p className="text-gray-500 mb-6">Link a physical NFC tag to a new database material.</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">NFC Tag UID (Scan to auto-fill)</label>
            <input
              type="text"
              required
              value={formData.nfcUid}
              onChange={(e) => setFormData({ ...formData, nfcUid: e.target.value })}
              className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., 6FDAABDD"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Material Name</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Base Alcohol 90%"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch Number (Optional)</label>
              <input
                type="text"
                value={formData.batchNo}
                onChange={(e) => setFormData({ ...formData, batchNo: e.target.value })}
                className="w-full border border-gray-300 rounded-md p-3"
                placeholder="e.g., BATCH-1042"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (Optional)</label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md p-3"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors"
          >
            Register Product
          </button>
        </form>

        {status.message && (
          <div className={`mt-4 p-4 rounded-md ${status.type === 'error' ? 'bg-red-50 text-red-700' : status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
            {status.message}
          </div>
        )}
      </div>
    </div>
  );
}
