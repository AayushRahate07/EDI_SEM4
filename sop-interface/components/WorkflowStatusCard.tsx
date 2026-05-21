"use client";
import React from "react";

interface SopNode {
  id: string;
  type: "VERIFICATION" | "MEASUREMENT" | "DECISION_BRANCH";
  title: string;
  config: Record<string, any>;
}

interface WorkflowStatusCardProps {
  currentStepId: string | null;
  completedSteps: string[];
  nodes: SopNode[];
  deviations: Array<{ stepId: string; issue: string; timestamp: string }>;
  status: string;
}

export default function WorkflowStatusCard({ currentStepId, completedSteps, nodes, deviations, status }: WorkflowStatusCardProps) {
  const currentNode = nodes.find((n) => n.id === currentStepId);
  const currentIndex = nodes.findIndex((n) => n.id === currentStepId);
  const totalSteps = nodes.length;
  const progress = totalSteps > 0 ? (completedSteps.length / totalSteps) * 100 : 0;
  const hasDeviation = deviations.some((d) => d.stepId === currentStepId);
  const isComplete = status === "COMPLETED";
  const stepStatus = isComplete ? "COMPLETE" : hasDeviation ? "DEVIATION" : currentNode ? "ACTIVE" : "PENDING";

  const sc = {
    ACTIVE:    { bg: "#0a1a10", border: "#10b981", text: "#2dd4a0", dot: "#10b981" },
    DEVIATION: { bg: "#1a0808", border: "#ef4444", text: "#f87171", dot: "#ef4444" },
    COMPLETE:  { bg: "#0a1020", border: "#3b82f6", text: "#60a5fa", dot: "#3b82f6" },
    PENDING:   { bg: "#0d0f14", border: "#2a2f3d", text: "#565d75", dot: "#3a4055" },
  }[stepStatus];

  const requirements: string[] = [];
  if (currentNode?.type === "VERIFICATION") {
    requirements.push(`Material: ${currentNode.config.entity_name || "—"}`);
    requirements.push(`Mode: ${currentNode.config.mode || "MANUAL_ENTRY"}`);
  } else if (currentNode?.type === "MEASUREMENT") {
    requirements.push(`Target: ${currentNode.config.target_value}${currentNode.config.unit}`);
    requirements.push(`Tolerance: ±${currentNode.config.tolerance_positive}${currentNode.config.unit}`);
    requirements.push(`Acceptable: ${currentNode.config.target_value - currentNode.config.tolerance_negative}–${currentNode.config.target_value + currentNode.config.tolerance_positive}${currentNode.config.unit}`);
  }

  return (
    <div style={{ background:"#0e1117", border:`1px solid ${sc.border}`, borderRadius:10, padding:"18px 20px", display:"flex", flexDirection:"column", gap:14, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, fontWeight:600, color:"#4b5563", letterSpacing:".1em", textTransform:"uppercase" }}>Workflow Status</span>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:sc.bg, border:`1px solid ${sc.border}`, borderRadius:4, padding:"3px 10px" }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:sc.dot, boxShadow:stepStatus==="ACTIVE"?`0 0 6px ${sc.dot}`:"none", animation:stepStatus==="ACTIVE"?"pulse-dot 1.5s infinite":"none" }} />
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:sc.text, fontWeight:600 }}>{stepStatus}</span>
        </div>
      </div>

      <div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#565d75" }}>STEP {currentIndex>=0?currentIndex+1:completedSteps.length} / {totalSteps}</span>
          <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:10, color:"#565d75" }}>{Math.round(progress)}%</span>
        </div>
        <div style={{ height:4, background:"#1c2130", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${progress}%`, background:isComplete?"#3b82f6":"#10b981", borderRadius:2, transition:"width 0.5s ease" }} />
        </div>
      </div>

      {currentNode ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:9, fontWeight:600, padding:"2px 7px", borderRadius:3, textTransform:"uppercase", background:currentNode.type==="VERIFICATION"?"#0a2620":"#0a1830", color:currentNode.type==="VERIFICATION"?"#2dd4a0":"#4da6ff", border:`1px solid ${currentNode.type==="VERIFICATION"?"#1a4a38":"#1a3060"}`, flexShrink:0 }}>{currentNode.type==="VERIFICATION"?"Verify":"Measure"}</span>
            <span style={{ fontSize:14, fontWeight:600, color:"#d4d8e8" }}>{currentNode.title}</span>
          </div>
          {requirements.length>0&&(
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <span style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".06em", fontFamily:"'IBM Plex Mono',monospace" }}>Required</span>
              {requirements.map((r,i)=><div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}><span style={{ color:"#3a4055", fontSize:11 }}>›</span><span style={{ fontSize:12, color:"#8890a8" }}>{r}</span></div>)}
            </div>
          )}
        </div>
      ) : isComplete ? (
        <div style={{ textAlign:"center", padding:"12px 0", color:"#3b82f6", fontSize:13, fontWeight:600 }}>✓ Workflow Complete</div>
      ) : (
        <div style={{ color:"#3a4055", fontSize:12, fontStyle:"italic" }}>No active step</div>
      )}

      {completedSteps.length>0&&(
        <div style={{ borderTop:"1px solid #1c2130", paddingTop:10 }}>
          <span style={{ fontSize:10, color:"#4b5563", textTransform:"uppercase", letterSpacing:".06em", fontFamily:"'IBM Plex Mono',monospace" }}>Completed</span>
          <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
            {nodes.filter(n=>completedSteps.includes(n.id)).map(n=>(
              <div key={n.id} style={{ display:"flex", alignItems:"center", gap:7, fontSize:11 }}>
                <span style={{ fontSize:10, color:"#2dd4a0" }}>✓</span>
                <span style={{ color:"#565d75" }}>{n.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
