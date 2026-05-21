"use client";
import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

const API = "http://localhost:3000";

interface StepRow {
  node_id:string; title:string; type:string; status:"PASS"|"DEVIATION"|"PENDING";
  submitted_value:any; target_value:number|null; unit:string|null; tolerance:string|null;
  expected_entity:string|null; timestamp:string|null; deviations:any[];
}
interface Report {
  run_id:string; sop_id:string; status:string;
  started_at:string; completed_at:string|null; duration_seconds:number;
  total_steps:number; passed_steps:number; failed_steps:number; pending_steps:number;
  operator_summary:{ peak_people_count:number; second_verifier_present:boolean; ppe_status:string; last_activity:string; };
  steps:StepRow[]; deviations:any[]; events_count:number;
}

function fmt(iso:string|null){if(!iso)return"—";try{return new Date(iso).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch{return iso}}
function fmtDur(s:number){const m=Math.floor(s/60),sec=s%60;return`${m}m ${sec}s`}

const statusColor = (s:string)=>{
  if(s==="PASS"||s==="COMPLETED")return{color:"#2dd4a0",bg:"#0a2620",border:"#1a4a38"};
  if(s==="DEVIATION"||s==="FAIL")return{color:"#ef4444",bg:"#1a0808",border:"#6b2230"};
  return{color:"#f59e0b",bg:"#1a1200",border:"#4a3600"};
};

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params?.id as string;
  const [report, setReport] = useState<Report|null>(null);
  const [error, setError] = useState<string|null>(null);

  useEffect(()=>{
    fetch(`${API}/runs/${runId}/report`)
      .then(r=>{ if(!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setReport)
      .catch(e=>setError(e.message));
  },[runId]);

  if(error) return <div style={{minHeight:"100vh",background:"#060810",display:"flex",alignItems:"center",justifyContent:"center",color:"#ef4444",fontFamily:"monospace"}}>{error}</div>;
  if(!report) return <div style={{minHeight:"100vh",background:"#060810",display:"flex",alignItems:"center",justifyContent:"center",color:"#2dd4a0",fontFamily:"monospace"}}>Generating report...</div>;

  const sc = statusColor(report.status);

  return (
    <div style={{ minHeight:"100vh", background:"#060810", color:"#d4d8e8", fontFamily:"'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Print styles */}
      <style>{`
        @media print {
          body{background:#fff!important;color:#000!important;}
          .no-print{display:none!important;}
          .print-card{background:#f8f9fa!important;border:1px solid #dee2e6!important;color:#000!important;}
          .print-table-header{background:#e9ecef!important;color:#000!important;}
        }
        @keyframes fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Header bar */}
      <div className="no-print" style={{ background:"#090a0f", borderBottom:"1px solid #1c2130", padding:"0 32px", height:50, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:24 }}>
          <button onClick={()=>router.push(`/runs/${runId}`)} style={{ background:"none", border:"none", color:"#4b5563", cursor:"pointer", fontSize:12, fontFamily:"'IBM Plex Mono',monospace" }}>← BACK TO DASHBOARD</button>
          <span style={{ color:"#2a2f3d" }}>|</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:600, color:"#d4d8e8" }}>COMPLIANCE REPORT</span>
        </div>
        <button onClick={()=>window.print()} style={{ background:"linear-gradient(135deg,#1a3060,#0a2620)", border:"1px solid #3b82f6", color:"#60a5fa", borderRadius:6, padding:"7px 18px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace" }}>
          🖨 Print / Save PDF
        </button>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"28px 32px 60px", animation:"fade-in .4s ease" }}>

        {/* Report Header */}
        <div className="print-card" style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:12, padding:"28px 32px", marginBottom:20, display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:20 }}>
          <div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".12em", marginBottom:8 }}>Batch Compliance Report</div>
            <h1 style={{ margin:0, fontSize:24, fontWeight:700, color:"#fff", letterSpacing:".02em" }}>{report.sop_id}</h1>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#565d75", marginTop:6 }}>Run ID: {report.run_id}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, ...sc, borderRadius:6, padding:"8px 18px", border:`1px solid ${sc.border}` }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:13, fontWeight:700, letterSpacing:".08em" }}>{report.status}</span>
          </div>
        </div>

        {/* Summary stat cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
          {[
            { label:"Total Steps", value:report.total_steps, color:"#d4d8e8" },
            { label:"Passed", value:report.passed_steps, color:"#2dd4a0" },
            { label:"Deviations", value:report.failed_steps, color:report.failed_steps>0?"#ef4444":"#2dd4a0" },
            { label:"Duration", value:fmtDur(report.duration_seconds), color:"#8890a8" },
          ].map(c=>(
            <div key={c.label} className="print-card" style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, padding:"20px 20px" }}>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", letterSpacing:".1em", marginBottom:8 }}>{c.label}</div>
              <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:26, fontWeight:700, color:c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Timing + Operator row */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
          {/* Timing */}
          <div className="print-card" style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, padding:"18px 20px" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".1em", marginBottom:12 }}>Timestamps</div>
            {[{l:"Started",v:fmt(report.started_at)},{l:"Completed",v:fmt(report.completed_at)},{l:"Duration",v:fmtDur(report.duration_seconds)},{l:"Events Logged",v:String(report.events_count)}].map(r=>(
              <div key={r.l} style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:12, color:"#4b5563" }}>{r.l}</span>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#8890a8" }}>{r.v}</span>
              </div>
            ))}
          </div>
          {/* Operator CV summary */}
          <div className="print-card" style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, padding:"18px 20px" }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".1em", marginBottom:12 }}>Operator Summary (CV)</div>
            {[
              {l:"People Detected",v:String(report.operator_summary.peak_people_count),pass:report.operator_summary.peak_people_count>=1},
              {l:"Second Verifier",v:report.operator_summary.second_verifier_present?"YES":"NO",pass:report.operator_summary.second_verifier_present},
              {l:"PPE Compliance",v:report.operator_summary.ppe_status,pass:report.operator_summary.ppe_status==="PASS"},
              {l:"Last Activity",v:report.operator_summary.last_activity,pass:true},
            ].map(r=>(
              <div key={r.l} style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:12, color:"#4b5563" }}>{r.l}</span>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:r.pass?"#2dd4a0":"#ef4444" }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step Audit Table */}
        <div className="print-card" style={{ background:"#0e1117", border:"1px solid #1c2130", borderRadius:10, overflow:"hidden", marginBottom:20 }}>
          <div className="print-table-header" style={{ background:"#090a0f", borderBottom:"1px solid #1c2130", padding:"14px 20px" }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:"#4b5563", textTransform:"uppercase", letterSpacing:".1em" }}>Step-by-Step Audit</span>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid #1c2130" }}>
                {["#","Step","Type","Submitted Value","Target","Result","Timestamp"].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontFamily:"'IBM Plex Mono',monospace", fontSize:9, color:"#4b5563", textTransform:"uppercase", letterSpacing:".08em", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.steps.map((step,i)=>{
                const sc2 = statusColor(step.status);
                const valueStr = step.submitted_value!=null ? (typeof step.submitted_value==="number" ? `${step.submitted_value}${step.unit??""}` : String(step.submitted_value)) : "—";
                const targetStr = step.target_value!=null ? `${step.target_value}${step.unit??""} ${step.tolerance??""}` : step.expected_entity??"—";
                return (
                  <tr key={step.node_id} style={{ borderBottom:"1px solid #1c2130", background:i%2===0?"transparent":"rgba(255,255,255,.01)" }}>
                    <td style={{ padding:"11px 14px", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#3a4055" }}>{i+1}</td>
                    <td style={{ padding:"11px 14px", fontSize:13, color:"#d4d8e8", fontWeight:500 }}>{step.title}</td>
                    <td style={{ padding:"11px 14px" }}>
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, padding:"2px 7px", borderRadius:3, background:step.type==="VERIFICATION"?"#0a2620":"#0a1830", color:step.type==="VERIFICATION"?"#2dd4a0":"#4da6ff", border:`1px solid ${step.type==="VERIFICATION"?"#1a4a38":"#1a3060"}` }}>{step.type==="VERIFICATION"?"VERIFY":"MEASURE"}</span>
                    </td>
                    <td style={{ padding:"11px 14px", fontFamily:"'IBM Plex Mono',monospace", fontSize:12, color:"#8890a8" }}>{valueStr}</td>
                    <td style={{ padding:"11px 14px", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:"#565d75" }}>{targetStr}</td>
                    <td style={{ padding:"11px 14px" }}>
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:700, padding:"3px 9px", borderRadius:3, background:sc2.bg, color:sc2.color, border:`1px solid ${sc2.border}` }}>{step.status}</span>
                    </td>
                    <td style={{ padding:"11px 14px", fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#3a4055" }}>{fmt(step.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Deviations */}
        {report.deviations.length>0&&(
          <div className="print-card" style={{ background:"#1a0808", border:"1px solid #7f1d1d", borderRadius:10, padding:"20px 24px", marginBottom:20 }}>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:"#ef4444", textTransform:"uppercase", letterSpacing:".1em", marginBottom:14 }}>⚠ Deviation Records ({report.deviations.length})</div>
            {report.deviations.map((d,i)=>(
              <div key={i} style={{ display:"flex", gap:12, marginBottom:10, paddingBottom:10, borderBottom:i<report.deviations.length-1?"1px solid #3d0f0f":"none" }}>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#4b5563", flexShrink:0 }}>[{fmt(d.timestamp)}]</span>
                <span style={{ fontSize:12, color:"#fca5a5" }}>{d.issue}</span>
                <span style={{ fontSize:11, color:"#565d75", marginLeft:"auto", flexShrink:0 }}>Step: {d.stepId}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign:"center", paddingTop:20, borderTop:"1px solid #1c2130" }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#3a4055" }}>
            Generated by SOP Compliance Engine · {new Date().toLocaleString()} · Run {report.run_id}
          </div>
        </div>
      </div>
    </div>
  );
}
