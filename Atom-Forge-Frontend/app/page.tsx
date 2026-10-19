"use client";

import { useState } from "react";
import MolViewer from "@/components/MolViewer";
import { getUserId } from "@/lib/user";

const API = process.env.NEXT_PUBLIC_API_URL;

type Molecule = {
  systematic_name?: string;
  chemical_name?: string;
  name?: string;
  common_name?: string;
  iupac_name?: string;
  iupac?: string;
  smiles: string;
  formula?: string;
  inchi?: string;
  selected_property?: string;
  predicted_property?: number;
  predicted_value?: number;
  target_property?: number | string;
  error?: number;
  accuracy?: number;
  image_base64?: string;
  image?: string;
  mol_3d_sdf?: string;
};

type HistoryRun = {
  id: number;
  property: string;
  target: number;
  total_candidates: number;
  created_at: string;
  molecules: Molecule[];
};

const PROPERTY_OPTIONS = ["MolWt", "LogP", "TPSA", "HBD", "HBA", "QED"];

const PROPERTY_CONFIG: Record<string, {
  placeholder: string;
  step: number;
  btnLabel: string;
  inputStep: string;
}> = {
  MolWt: { placeholder: "e.g. 300",  step: 10,   btnLabel: "+10",   inputStep: "1"    },
  LogP:  { placeholder: "e.g. 2.5",  step: 0.5,  btnLabel: "+0.5",  inputStep: "0.1"  },
  TPSA:  { placeholder: "e.g. 140",  step: 10,   btnLabel: "+10",   inputStep: "1"    },
  HBD:   { placeholder: "e.g. 2",    step: 1,    btnLabel: "+1",    inputStep: "1"    },
  HBA:   { placeholder: "e.g. 5",    step: 1,    btnLabel: "+1",    inputStep: "1"    },
  QED:   { placeholder: "e.g. 0.80", step: 0.05, btnLabel: "+0.05", inputStep: "0.01" },
};

// Shared inline styles
const box: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #888",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
};
const btnActive: React.CSSProperties = { ...btn, background: "#dde9ff", borderColor: "#3b6fd4" };
const input: React.CSSProperties = {
  padding: 8,
  border: "1px solid #888",
  borderRadius: 6,
  flex: 1,
};
const label: React.CSSProperties = { display: "block", fontWeight: 600, marginBottom: 6 };

export default function Home() {
  const [targetProperty, setTargetProperty] = useState("QED");
  const [targetValue, setTargetValue] = useState("");
  const [numSamples, setNumSamples] = useState(300);
  const [loading, setLoading] = useState(false);

  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [resultMeta, setResultMeta] = useState({ property: "", target: "" });
  const [view3D, setView3D] = useState<Record<number, boolean>>({});
  const [moleculeRatings, setMoleculeRatings] = useState<Record<number, number>>({});

  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [generalRating, setGeneralRating] = useState<1 | -1 | null>(null);
  const [generalComment, setGeneralComment] = useState("");
  const [generalSent, setGeneralSent] = useState(false);

  // ---------- helpers ----------
  const errorMessage = (data: any, fallback: string) =>
    typeof data?.detail === "string" ? data.detail : fallback;

  const sendFeedback = async (body: object) => {
    const res = await fetch(`${API}/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": getUserId(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(errorMessage(data, "Could not send feedback."));
    }
  };

  // ---------- generation ----------
  const generateMolecules = async () => {
    if (targetValue === "" || isNaN(Number(targetValue))) {
      alert("Please enter a target value.");
      return;
    }

    setLoading(true);
    setMolecules([]);
    setView3D({});
    setMoleculeRatings({});
    try {
      const response = await fetch(`${API}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getUserId(),
        },
        body: JSON.stringify({
          property: targetProperty,
          target: Number(targetValue),
          num_random: Math.floor(numSamples / 2),
          num_local: Math.floor(numSamples / 2),
          top_images: 10,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(errorMessage(data, "Generation failed"));
      }
      const data = await response.json();
      setMolecules(data.molecules || []);
      setResultMeta({ property: targetProperty, target: targetValue });

      if (showHistory) loadHistory();
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to generate molecules.");
    } finally {
      setLoading(false);
    }
  };

  // ---------- history ----------
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/history/${getUserId()}`);
      if (!res.ok) throw new Error("Could not load history.");
      setHistory(await res.json());
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to load history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) loadHistory();
  };

  const showPastRun = (run: HistoryRun) => {
    setMolecules(run.molecules);
    setView3D({});
    setMoleculeRatings({});
    setResultMeta({ property: run.property, target: String(run.target) });
  };

  // ---------- feedback ----------
  const rateMolecule = async (idx: number, smiles: string, rating: 1 | -1) => {
    try {
      await sendFeedback({ kind: "molecule", smiles, rating });
      setMoleculeRatings((prev) => ({ ...prev, [idx]: rating }));
    } catch (error: any) {
      alert(error.message);
    }
  };

  const submitGeneralFeedback = async () => {
    if (!generalComment.trim() && generalRating === null) {
      alert("Please write a comment or pick a rating.");
      return;
    }
    try {
      await sendFeedback({
        kind: "general",
        rating: generalRating,
        comment: generalComment.trim() || null,
      });
      setGeneralSent(true);
      setGeneralComment("");
      setGeneralRating(null);
    } catch (error: any) {
      alert(error.message);
    }
  };

  // ---------- render ----------
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Atom Forge</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Generate drug-like molecules by specifying a target property value.
      </p>

      {/* ── GENERATION FORM ── */}
      <section style={box}>
        <h2 style={{ marginBottom: 12 }}>Generate molecules</h2>

        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={label}>Target property</label>
            <select
              value={targetProperty}
              onChange={(e) => {
                setTargetProperty(e.target.value);
                setTargetValue("");
              }}
              style={{ ...input, width: "100%" }}
            >
              {PROPERTY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={label}>Target value</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                step={PROPERTY_CONFIG[targetProperty].inputStep}
                value={targetValue}
                placeholder={PROPERTY_CONFIG[targetProperty].placeholder}
                onChange={(e) => setTargetValue(e.target.value)}
                style={input}
              />
              <button
                style={btn}
                onClick={() => {
                  const cfg = PROPERTY_CONFIG[targetProperty];
                  const current = parseFloat(targetValue) || 0;
                  const decimals = cfg.inputStep.includes(".")
                    ? cfg.inputStep.split(".")[1].length
                    : 0;
                  setTargetValue((current + cfg.step).toFixed(decimals));
                }}
              >
                {PROPERTY_CONFIG[targetProperty].btnLabel}
              </button>
            </div>
          </div>
        </div>

        <label style={label}>Number of samples: {numSamples}</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button style={btn} onClick={() => setNumSamples((p) => Math.max(1, p - 1))}>−</button>
          <button style={btn} onClick={() => setNumSamples((p) => p + 100)}>+100</button>
        </div>

        <button
          onClick={generateMolecules}
          disabled={loading}
          style={{ ...btnActive, width: "100%", padding: 12, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Generating… this may take a while" : "Generate"}
        </button>
      </section>

      {/* ── HISTORY ── */}
      <section style={box}>
        <button style={btn} onClick={toggleHistory}>
          {showHistory ? "Hide my history" : "Show my history"}
        </button>

        {showHistory && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {historyLoading && <p>Loading history…</p>}
            {!historyLoading && history.length === 0 && <p>No past runs yet.</p>}
            {history.map((run) => (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                <div>
                  <strong>{run.property}</strong> target {run.target}
                  <div style={{ fontSize: 13, color: "#666" }}>
                    {run.total_candidates} candidates · {new Date(run.created_at).toLocaleString()}
                  </div>
                </div>
                <button style={btn} onClick={() => showPastRun(run)}>View</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── RESULTS ── */}
      {molecules.length > 0 && (
        <section style={box}>
          <p style={{ marginBottom: 16, color: "#444" }}>
            {molecules.length} candidate{molecules.length !== 1 ? "s" : ""} · property: {resultMeta.property} · target: {resultMeta.target}
          </p>

          {molecules.map((m, idx) => (
            <div
              key={idx}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              {/* Left: info */}
              <div>
                <h3 style={{ marginBottom: 8, wordBreak: "break-word" }}>
                  {m.systematic_name || m.iupac_name || m.chemical_name || m.name ||
                    `Novel ${m.selected_property || resultMeta.property} candidate`}
                </h3>

                <p style={{ wordBreak: "break-all", fontSize: 13 }}><strong>SMILES:</strong> {m.smiles}</p>
                <p style={{ fontSize: 13 }}>
                  <strong>IUPAC:</strong> {m.iupac_name || m.iupac || "not found"}
                </p>
                <p style={{ fontSize: 13 }}>
                  <strong>Common name:</strong> {m.common_name || "not found"}
                </p>
                {m.formula && <p style={{ fontSize: 13 }}><strong>Formula:</strong> {m.formula}</p>}
                {m.inchi && (
                  <p style={{ fontSize: 11, wordBreak: "break-all" }}><strong>InChI:</strong> {m.inchi}</p>
                )}

                <p style={{ fontSize: 13 }}>
                  <strong>Property:</strong> {m.selected_property || resultMeta.property}
                </p>
                <p style={{ fontSize: 13 }}>
                  <strong>Predicted value:</strong>{" "}
                  {typeof m.predicted_property === "number"
                    ? m.predicted_property.toFixed(4)
                    : typeof m.predicted_value === "number"
                      ? m.predicted_value.toFixed(4)
                      : "—"}
                </p>
                <p style={{ fontSize: 13 }}>
                  <strong>Accuracy:</strong>{" "}
                  {typeof m.accuracy === "number"
                    ? m.accuracy > 1
                      ? `${m.accuracy.toFixed(2)}%`
                      : `${(m.accuracy * 100).toFixed(2)}%`
                    : "—"}
                </p>

                {/* Molecule feedback */}
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>Useful?</span>
                  <button
                    style={moleculeRatings[idx] === 1 ? btnActive : btn}
                    disabled={moleculeRatings[idx] !== undefined}
                    onClick={() => rateMolecule(idx, m.smiles, 1)}
                  >
                    👍
                  </button>
                  <button
                    style={moleculeRatings[idx] === -1 ? btnActive : btn}
                    disabled={moleculeRatings[idx] !== undefined}
                    onClick={() => rateMolecule(idx, m.smiles, -1)}
                  >
                    👎
                  </button>
                  {moleculeRatings[idx] !== undefined && (
                    <span style={{ fontSize: 12, color: "#666" }}>Thanks for the feedback</span>
                  )}
                </div>
              </div>

              {/* Right: image or 3D view */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                {m.mol_3d_sdf && (
                  <button
                    style={{ ...btn, marginBottom: 8 }}
                    onClick={() => setView3D((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                  >
                    {view3D[idx] ? "Show 2D" : "Show 3D"}
                  </button>
                )}

                {m.mol_3d_sdf && view3D[idx] ? (
                  <MolViewer sdfString={m.mol_3d_sdf} width={244} height={244} />
                ) : m.image_base64 || m.image ? (
                  <img
                    src={
                      m.image_base64
                        ? `data:image/png;base64,${m.image_base64}`
                        : m.image || ""
                    }
                    alt={m.systematic_name || m.smiles}
                    style={{ width: 220, height: "auto" }}
                  />
                ) : (
                  <p style={{ fontSize: 13, color: "#888" }}>Image not stored in history</p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── GENERAL FEEDBACK ── */}
      <section style={box}>
        <h2 style={{ marginBottom: 12 }}>Feedback</h2>

        {generalSent ? (
          <p>Thank you! Your feedback was saved.</p>
        ) : (
          <>
            <p style={{ marginBottom: 8, fontSize: 14 }}>How is the app working for you?</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                style={generalRating === 1 ? btnActive : btn}
                onClick={() => setGeneralRating(generalRating === 1 ? null : 1)}
              >
                👍
              </button>
              <button
                style={generalRating === -1 ? btnActive : btn}
                onClick={() => setGeneralRating(generalRating === -1 ? null : -1)}
              >
                👎
              </button>
            </div>
            <textarea
              value={generalComment}
              onChange={(e) => setGeneralComment(e.target.value)}
              placeholder="Anything you'd like to tell us? Bugs, ideas, or problems."
              rows={4}
              maxLength={2000}
              style={{ ...input, width: "100%", display: "block", marginBottom: 8, resize: "vertical" }}
            />
            <button style={btnActive} onClick={submitGeneralFeedback}>
              Send feedback
            </button>
          </>
        )}
      </section>
    </main>
  );
}