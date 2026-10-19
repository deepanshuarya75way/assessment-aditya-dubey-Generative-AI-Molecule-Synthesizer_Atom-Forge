"use client";

import { useState, useEffect } from "react";
import MolViewer from "@/components/MolViewer";

type Feedback = {
  rating: number;
  comment: string;
};

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

const PROPERTY_OPTIONS = ["MolWt", "LogP", "TPSA", "HBD", "HBA", "QED"];

const PROPERTY_CONFIG: Record<string, {
  placeholder: string;
  step:        number;
  btnLabel:    string;
  inputStep:   string;
}> = {
  MolWt: { placeholder: "e.g. 300",  step: 10,   btnLabel: "+10",   inputStep: "1"    },
  LogP:  { placeholder: "e.g. 2.5",  step: 0.5,  btnLabel: "+0.5",  inputStep: "0.1"  },
  TPSA:  { placeholder: "e.g. 140",  step: 10,   btnLabel: "+10",   inputStep: "1"    },
  HBD:   { placeholder: "e.g. 2",    step: 1,    btnLabel: "+1",    inputStep: "1"    },
  HBA:   { placeholder: "e.g. 5",    step: 1,    btnLabel: "+1",    inputStep: "1"    },
  QED:   { placeholder: "e.g. 0.80", step: 0.05, btnLabel: "+0.05", inputStep: "0.01" },
};

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: `${(i * 5.7 + 3) % 100}%`,
  width: `${2 + (i % 3)}px`,
  height: `${2 + (i % 3)}px`,
  duration: `${12 + (i % 8) * 2}s`,
  delay: `${-(i * 1.3)}s`,
  opacity: 0.3 + (i % 4) * 0.12,
}));

export default function Home() {
  const [targetProperty, setTargetProperty] = useState("QED");
  const [targetValue, setTargetValue]       = useState("");
  const [numSamples, setNumSamples]         = useState(300);
  const [molecules, setMolecules]           = useState<Molecule[]>([]);
  const [loading, setLoading]               = useState(false);
  const [view3D, setView3D]                 = useState<Record<number, boolean>>({});
  const [feedback, setFeedback] = useState<
  Record<number, Feedback>
>({});

  useEffect(() => {}, []);
  useEffect(() => {
  setTargetValue("");
  }, [targetProperty]);

  const generateMolecules = async () => {

    if (targetValue === "" || isNaN(Number(targetValue))) {
    alert("Please enter a target value.");
    return;
    }

    setLoading(true);
    setMolecules([]);
    setView3D({});
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/generate`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property:   targetProperty,
            target:     Number(targetValue),
            num_random: Math.floor(numSamples / 2),
            num_local:  Math.floor(numSamples / 2),
            top_images: 10,
          }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Generation failed");
      }
      const data = await response.json();
      setMolecules(data.molecules || []);
    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to generate molecules.");
    } finally {
      setLoading(false);
    }
  };
 const handleFeedbackSubmit = (index: number) => {
  const moleculeFeedback = feedback[index];

  if (!moleculeFeedback || moleculeFeedback.rating === 0) {
    alert("Please select a rating first.");
    return;
  }

  console.log("Molecule:", molecules[index].smiles);
  console.log("Rating:", moleculeFeedback.rating);
  console.log("Comment:", moleculeFeedback.comment);

  alert("Feedback submitted successfully!");
};
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .af-root {
          min-height: 100vh;
          background: #020c14;
          color: #d0eef7;
          font-family: 'DM Sans', sans-serif;
          overflow-x: hidden;
          position: relative;
        }

        .af-grid {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-image:
            linear-gradient(rgba(0,229,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,255,0.035) 1px, transparent 1px);
          background-size: 44px 44px;
        }
        .af-scanlines {
          position: fixed; inset: 0; pointer-events: none; z-index: 1;
          background: repeating-linear-gradient(
            to bottom,
            transparent 0px, transparent 3px,
            rgba(0,229,255,0.012) 3px, rgba(0,229,255,0.012) 4px
          );
        }
        .af-sweep {
          position: fixed; left: 0; right: 0; height: 2px; z-index: 2; pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(0,229,255,0.5), transparent);
          animation: afSweep 7s linear infinite;
        }
        @keyframes afSweep {
          0%   { top: -2px; opacity: 0; }
          4%   { opacity: 1; }
          96%  { opacity: 0.7; }
          100% { top: 100vh; opacity: 0; }
        }

        .af-particle {
          position: fixed; border-radius: 50%;
          background: rgba(0,229,255,0.55);
          animation: afFloat linear infinite;
          pointer-events: none; z-index: 1;
        }
        @keyframes afFloat {
          0%   { transform: translateY(105vh) scale(0.8) rotate(0deg); opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 0.8; }
          100% { transform: translateY(-120px) scale(1.1) rotate(540deg); opacity: 0; }
        }

        .af-blob {
          position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
          filter: blur(120px); animation: afPulseBlob 8s ease-in-out infinite alternate;
        }
        .af-blob-1 { width: 600px; height: 600px; top: -200px; left: -100px; background: rgba(0,229,255,0.04); }
        .af-blob-2 { width: 500px; height: 500px; bottom: -150px; right: -80px; background: rgba(140,0,255,0.05); animation-delay: -4s; }
        @keyframes afPulseBlob {
          from { opacity: 0.6; transform: scale(1); }
          to   { opacity: 1;   transform: scale(1.15); }
        }

        .af-hero { padding: 72px 16px 0; text-align: center; }
        .af-eyebrow {
          font-family: 'Space Mono', monospace;
          font-size: 11px; letter-spacing: 0.22em;
          color: rgba(0,229,255,0.55); text-transform: uppercase;
          margin-bottom: 18px;
          animation: afFadeUp 0.8s both;
        }
        .af-title {
          font-family: 'Orbitron', monospace;
          font-weight: 900;
          font-size: clamp(3.2rem, 10vw, 7.5rem);
          letter-spacing: 0.08em;
          line-height: 1;
          background: linear-gradient(130deg, #00e5ff 0%, #80ffdb 35%, #00bcd4 60%, #aa00ff 100%);
          background-size: 220% 220%;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          animation: afTitleShimmer 5s ease infinite, afFadeUp 0.9s 0.1s both;
          filter: drop-shadow(0 0 28px rgba(0,229,255,0.25));
        }
        @keyframes afTitleShimmer {
          0%,100% { background-position: 0% 50%; }
          50%     { background-position: 100% 50%; }
        }
        .af-subtitle-text {
          margin: 22px auto 0; max-width: 680px;
          font-size: 15px; line-height: 1.75;
          color: rgba(208,238,247,0.52);
          animation: afFadeUp 0.9s 0.2s both;
        }
        @keyframes afFadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .af-main { padding: 48px 16px 80px; display: flex; justify-content: center; }
        .af-panel {
          width: 100%; max-width: 1100px;
          background: rgba(2,12,22,0.82);
          border: 1px solid rgba(0,229,255,0.13);
          border-radius: 28px;
          backdrop-filter: blur(24px);
          padding: 40px;
          position: relative; overflow: hidden;
          box-shadow:
            0 0 0 1px rgba(0,229,255,0.04) inset,
            0 40px 120px rgba(0,0,0,0.5),
            0 0 80px rgba(0,229,255,0.04);
          animation: afFadeUp 1s 0.3s both;
        }
        .af-panel-top-line {
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,229,255,0.55), rgba(140,0,255,0.35), transparent);
        }
        .af-c { position: absolute; width: 18px; height: 18px; }
        .af-c-tl { top: 14px; left: 14px; border-top: 1.5px solid rgba(0,229,255,0.35); border-left: 1.5px solid rgba(0,229,255,0.35); }
        .af-c-tr { top: 14px; right: 14px; border-top: 1.5px solid rgba(0,229,255,0.35); border-right: 1.5px solid rgba(0,229,255,0.35); }
        .af-c-bl { bottom: 14px; left: 14px; border-bottom: 1.5px solid rgba(0,229,255,0.35); border-left: 1.5px solid rgba(0,229,255,0.35); }
        .af-c-br { bottom: 14px; right: 14px; border-bottom: 1.5px solid rgba(0,229,255,0.35); border-right: 1.5px solid rgba(0,229,255,0.35); }

        .af-section-title {
          font-family: 'Orbitron', monospace;
          font-size: 17px; font-weight: 700;
          color: #d0eef7; letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
        .af-section-sub { font-size: 13px; color: rgba(208,238,247,0.42); margin-bottom: 28px; }
        .af-dna-icon { margin-right: 8px; }

        .af-label {
          display: block;
          font-family: 'Space Mono', monospace;
          font-size: 10px; letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(0,229,255,0.55);
          margin-bottom: 8px;
        }

        .af-select {
          width: 100%; padding: 13px 16px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(0,229,255,0.14);
          border-radius: 12px;
          color: #d0eef7;
          font-family: 'Space Mono', monospace; font-size: 13px;
          outline: none; cursor: pointer;
          transition: border-color 0.25s, box-shadow 0.25s;
          appearance: none; -webkit-appearance: none;
        }
        .af-select:focus {
          border-color: rgba(0,229,255,0.5);
          box-shadow: 0 0 0 3px rgba(0,229,255,0.08), 0 0 20px rgba(0,229,255,0.12);
        }
        .af-select option { background: #020c14; }

        .af-input {
          flex: 1; padding: 13px 16px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(0,229,255,0.14);
          border-radius: 12px;
          color: #d0eef7;
          font-family: 'Space Mono', monospace; font-size: 13px;
          outline: none;
          transition: border-color 0.25s, box-shadow 0.25s;
        }

        .af-input::placeholder {
          color: rgba(0,229,255,0.22);
          font-style: italic;
        }
        .af-input:focus {
          border-color: rgba(0,229,255,0.5);
          box-shadow: 0 0 0 3px rgba(0,229,255,0.08), 0 0 20px rgba(0,229,255,0.12);
        }

        .af-btn-sm {
          padding: 12px 16px;
          background: rgba(0,229,255,0.07);
          border: 1px solid rgba(0,229,255,0.22);
          border-radius: 10px;
          color: #00e5ff;
          font-family: 'Space Mono', monospace; font-size: 13px;
          cursor: pointer;
          transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
          white-space: nowrap;
        }
        .af-btn-sm:hover { background: rgba(0,229,255,0.15); box-shadow: 0 0 14px rgba(0,229,255,0.2); transform: translateY(-1px); }
        .af-btn-sm:active { transform: scale(0.97); }

        .af-view-toggle {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 14px;
          background: rgba(0,229,255,0.06);
          border: 1px solid rgba(0,229,255,0.2);
          border-radius: 999px;
          color: #00e5ff;
          font-family: 'Space Mono', monospace;
          font-size: 9px; letter-spacing: 0.12em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.2s, box-shadow 0.2s;
          margin-bottom: 10px;
        }
        .af-view-toggle:hover { background: rgba(0,229,255,0.14); box-shadow: 0 0 14px rgba(0,229,255,0.18); }
        .af-view-toggle-dot { width: 6px; height: 6px; border-radius: 50%; background: #00e5ff; box-shadow: 0 0 6px rgba(0,229,255,0.9); }

        .af-counter-box {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px;
          background: rgba(0,0,0,0.45);
          border: 1px solid rgba(0,229,255,0.14);
          border-radius: 12px;
          transition: border-color 0.25s;
        }
        .af-counter-box:hover { border-color: rgba(0,229,255,0.28); }
        .af-counter-num {
          font-family: 'Orbitron', monospace;
          font-size: 22px; font-weight: 700;
          color: #00e5ff;
          text-shadow: 0 0 20px rgba(0,229,255,0.45);
          letter-spacing: 0.04em;
        }

        .af-btn-generate-wrap { position: relative; }
        .af-btn-generate {
          width: 100%; padding: 17px;
          background: linear-gradient(135deg, rgba(0,229,255,0.12) 0%, rgba(0,160,200,0.1) 50%, rgba(140,0,255,0.12) 100%);
          border: 1px solid rgba(0,229,255,0.38);
          border-radius: 14px;
          color: #00e5ff;
          font-family: 'Orbitron', monospace;
          font-weight: 700; font-size: 13px;
          letter-spacing: 0.18em; text-transform: uppercase;
          cursor: pointer; position: relative; overflow: hidden;
          transition: all 0.3s cubic-bezier(0.23,1,0.32,1);
        }
        .af-btn-generate:not(:disabled):hover {
          border-color: rgba(0,229,255,0.75);
          box-shadow: 0 0 35px rgba(0,229,255,0.28), 0 0 80px rgba(0,229,255,0.1), 0 4px 30px rgba(0,0,0,0.4);
          transform: translateY(-2px);
          background: linear-gradient(135deg, rgba(0,229,255,0.22) 0%, rgba(0,160,200,0.18) 50%, rgba(140,0,255,0.18) 100%);
        }
        .af-btn-generate:active:not(:disabled) { transform: scale(0.99); }
        .af-btn-generate:disabled { opacity: 0.45; cursor: not-allowed; }
        .af-pulse-ring {
          position: absolute; inset: 0; border-radius: 14px;
          border: 1px solid rgba(0,229,255,0.4);
          animation: afPulseRing 2.4s ease-out infinite;
          pointer-events: none;
        }
        .af-pulse-ring-2 { animation-delay: 0.8s; }
        .af-pulse-ring-3 { animation-delay: 1.6s; }
        @keyframes afPulseRing {
          0%   { opacity: 0.8; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.06); }
        }
        .af-btn-generate::after {
          content: ''; position: absolute;
          top: 50%; left: 50%; width: 0; height: 0;
          background: rgba(0,229,255,0.12); border-radius: 50%;
          transform: translate(-50%,-50%);
          transition: width 0.5s, height 0.5s, opacity 0.5s;
          opacity: 0;
        }
        .af-btn-generate:active::after { width: 500px; height: 500px; opacity: 1; }

        .af-loading-dots { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .af-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #00e5ff;
          box-shadow: 0 0 8px rgba(0,229,255,0.9);
          animation: afDotBounce 1.2s ease-in-out infinite;
        }
        .af-dot:nth-child(2) { animation-delay: 0.15s; }
        .af-dot:nth-child(3) { animation-delay: 0.30s; }
        @keyframes afDotBounce {
          0%,100% { opacity: 0.25; transform: scale(0.75) translateY(0); }
          50%     { opacity: 1;    transform: scale(1.2)  translateY(-4px); }
        }

        .af-sep { height: 1px; margin: 8px 0; background: linear-gradient(90deg, transparent, rgba(0,229,255,0.18), transparent); }

        .af-results-header {
          display: flex; align-items: center; gap: 10px;
          padding: 11px 16px;
          background: rgba(0,229,255,0.04);
          border: 1px solid rgba(0,229,255,0.1);
          border-radius: 10px;
          font-family: 'Space Mono', monospace;
          font-size: 11px; letter-spacing: 0.1em;
          color: rgba(0,229,255,0.65);
          text-transform: uppercase;
        }
        .af-live-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #00e5ff; box-shadow: 0 0 8px rgba(0,229,255,0.9);
          animation: afBlink 1.6s ease-in-out infinite;
          flex-shrink: 0;
        }
        @keyframes afBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }

        .af-mol-card {
          background: rgba(2,12,22,0.8);
          border: 1px solid rgba(0,229,255,0.09);
          border-radius: 20px; padding: 26px;
          display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
          position: relative; overflow: hidden;
          transition: transform 0.4s cubic-bezier(0.23,1,0.32,1), border-color 0.3s, box-shadow 0.4s;
        }
        .af-mol-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,229,255,0.3), transparent);
          opacity: 0; transition: opacity 0.3s;
        }
        .af-mol-card:hover::before { opacity: 1; }
        .af-mol-card:hover {
          border-color: rgba(0,229,255,0.25);
          box-shadow: 0 0 50px rgba(0,229,255,0.07), 0 20px 60px rgba(0,0,0,0.35);
          transform: translateY(-3px);
        }
        @keyframes afCardIn {
          from { opacity: 0; transform: translateY(28px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (max-width: 640px) {
          .af-mol-card { grid-template-columns: 1fr; }
          .af-panel { padding: 24px; }
          .af-title { font-size: clamp(2.5rem,12vw,4rem); }
        }

        .af-mol-name {
          font-family: 'Space Mono', monospace;
          font-size: 15px; font-weight: 700;
          color: #e0f7fa; word-break: break-word; line-height: 1.4;
          margin-bottom: 8px;
        }
        .af-badge {
          display: inline-block; padding: 3px 11px;
          border-radius: 999px;
          background: rgba(0,229,255,0.09);
          border: 1px solid rgba(0,229,255,0.2);
          color: #00e5ff;
          font-family: 'Space Mono', monospace;
          font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
        }
        .af-data { margin-top: 14px; }
        .af-data-row {
          font-family: 'Space Mono', monospace; font-size: 11px;
          color: rgba(208,238,247,0.5); line-height: 1.85; word-break: break-all;
        }
        .af-data-key { color: rgba(0,229,255,0.7); margin-right: 4px; }

        .af-metrics { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-top: 16px; }
        .af-metric {
          padding: 12px 8px; border-radius: 11px; text-align: center;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(0,229,255,0.1);
          transition: border-color 0.25s, box-shadow 0.25s;
        }
        .af-metric:hover { border-color: rgba(0,229,255,0.28); box-shadow: 0 0 16px rgba(0,229,255,0.07); }
        .af-metric-lbl { font-family: 'Space Mono', monospace; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(0,229,255,0.45); margin-bottom: 5px; }
        .af-metric-val { font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; color: #00e5ff; }
        .af-metric-acc { background: rgba(170,255,0,0.04); border-color: rgba(170,255,0,0.18); }
        .af-metric-acc:hover { border-color: rgba(170,255,0,0.38); box-shadow: 0 0 16px rgba(170,255,0,0.08); }
        .af-metric-acc .af-metric-lbl { color: rgba(170,255,0,0.5); }
        .af-metric-acc .af-metric-val { color: #aaff00; text-shadow: 0 0 12px rgba(170,255,0,0.5); }

        .af-img-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .af-img-box {
          position: relative; padding: 22px;
          background: rgba(0,229,255,0.025);
          border: 1px solid rgba(0,229,255,0.1);
          border-radius: 18px; overflow: hidden;
        }
        .af-img-box::before {
          content: ''; position: absolute; inset: -60%;
          background: conic-gradient(from 0deg, transparent 65%, rgba(0,229,255,0.08) 78%, transparent 90%);
          animation: afOrbit 7s linear infinite;
        }
        @keyframes afOrbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .af-mol-img {
          width: 200px; object-fit: contain; display: block;
          position: relative; z-index: 1;
          filter: drop-shadow(0 0 12px rgba(0,229,255,0.18));
          transition: transform 0.4s cubic-bezier(0.23,1,0.32,1), filter 0.4s;
        }
        .af-mol-img:hover { transform: scale(1.1) rotate(3deg); filter: drop-shadow(0 0 24px rgba(0,229,255,0.55)); }

        .af-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 640px) { .af-form-grid { grid-template-columns: 1fr; } }
        .af-field { display: flex; flex-direction: column; gap: 0; }
        .af-input-row { display: flex; gap: 8px; }
        .af-space { height: 20px; }
        .af-mol-cards-space { display: flex; flex-direction: column; gap: 18px; margin-top: 8px; }

        
      `
      {/* FEEDBACK SECTION */}
<div className="af-feedback">
  <h3>Feedback for this molecule</h3>

  <p className="af-feedback-subtitle">
    How would you rate this molecule?
  </p>

  <div className="af-rating">
    {[1, 2, 3, 4, 5].map((rating) => (
      <button
        key={rating}
        type="button"
        className={
          (feedback[idx]?.rating || 0) >= rating
            ? "af-star af-star-active"
            : "af-star"
        }
        onClick={() =>
          setFeedback((prev) => ({
            ...prev,
            [idx]: {
              rating,
              comment: prev[idx]?.comment || "",
            },
          }))
        }
        aria-label={`${rating} out of 5 stars`}
      >
        ★
      </button>
    ))}
  </div>

  <label className="af-label" htmlFor={`feedback-${idx}`}>
    Your comments
  </label>

  <textarea
    id={`feedback-${idx}`}
    className="af-feedback-input"
    placeholder="Share your thoughts about this molecule..."
    rows={3}
    value={feedback[idx]?.comment || ""}
    onChange={(e) =>
      setFeedback((prev) => ({
        ...prev,
        [idx]: {
          rating: prev[idx]?.rating || 0,
          comment: e.target.value,
        },
      }))
    }
  />

  <button
    type="button"
    className="af-feedback-submit"
    onClick={() => handleFeedbackSubmit(idx)}
  >
    Submit Feedback
  </button>
</div>
{/* END FEEDBACK SECTION */}
      
      }</style>

      <div className="af-root">
        <div className="af-grid" />
        <div className="af-scanlines" />
        <div className="af-sweep" />
        <div className="af-blob af-blob-1" />
        <div className="af-blob af-blob-2" />

        {PARTICLES.map((p) => (
          <div
            key={p.id}
            className="af-particle"
            style={{
              left:              p.left,
              width:             p.width,
              height:            p.height,
              animationDuration: p.duration,
              animationDelay:    p.delay,
              opacity:           p.opacity,
            }}
          />
        ))}

        {/* ── HERO ── */}
        <div className="af-hero" style={{ position: "relative", zIndex: 10 }}>
          <p className="af-eyebrow">◈ Generative AI · Drug Discovery · Molecular Design</p>
          <h1 className="af-title">ATOM FORGE</h1>
          <p className="af-subtitle-text">
            Helping in designing novel drug-like molecules using generative AI by specifying
            target physicochemical properties such as QED, LogP, TPSA, molecular weight, and
            hydrogen bond characteristics. Synthesizes optimized candidates and visualizes their
            structures, predicted values, and accuracy in real time.
          </p>
        </div>

        {/* ── MAIN PANEL ── */}
        <div className="af-main" style={{ position: "relative", zIndex: 10 }}>
          <div className="af-panel">
            <div className="af-c af-c-tl" />
            <div className="af-c af-c-tr" />
            <div className="af-c af-c-bl" />
            <div className="af-c af-c-br" />
            <div className="af-panel-top-line" />

            <h2 className="af-section-title">
              <span className="af-dna-icon">⬡</span>
              Molecular Generation Engine
            </h2>
            <p className="af-section-sub">
              Configure target property parameters and initiate AI-driven synthesis.
            </p>

            {/* Property + Target Value */}
            <div className="af-form-grid">
              <div className="af-field">
                <label className="af-label">Target Property</label>
                <select
                  value={targetProperty}
                  onChange={(e) => setTargetProperty(e.target.value)}
                  className="af-select"
                >
                  {PROPERTY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

                          <div className="af-field">
              <label className="af-label">Target Value</label>
              <div className="af-input-row">
                <input
                  type="number"
                  step={PROPERTY_CONFIG[targetProperty].inputStep}
                  value={targetValue}
                  placeholder={PROPERTY_CONFIG[targetProperty].placeholder}
                  onChange={(e) => setTargetValue(e.target.value)}
                  className="af-input"
                />
                <button
                  onClick={() => {
                    const current = parseFloat(targetValue) || 0;
                    const next    = current + PROPERTY_CONFIG[targetProperty].step;
                    // Decimal precision matching the step
                    const decimals = PROPERTY_CONFIG[targetProperty].inputStep.includes(".")
                      ? PROPERTY_CONFIG[targetProperty].inputStep.split(".")[1].length
                      : 0;
                    setTargetValue(next.toFixed(decimals));
                  }}
                  className="af-btn-sm"
                >
                  {PROPERTY_CONFIG[targetProperty].btnLabel}
                </button>
              </div>
            </div>
            </div>

            <div className="af-space" />

            {/* Samples counter */}
            <label className="af-label">Number of Samples</label>
            <div className="af-counter-box">
              <button onClick={() => setNumSamples((p) => Math.max(1, p - 1))} className="af-btn-sm">−</button>
              <span className="af-counter-num">{numSamples}</span>
              <button onClick={() => setNumSamples((p) => p + 100)} className="af-btn-sm">+100</button>
            </div>

            <div className="af-space" />

            {/* ── GENERATE BUTTON ── */}
            <div className="af-btn-generate-wrap">
              {!loading && (
                <>
                  <div className="af-pulse-ring" />
                  <div className="af-pulse-ring af-pulse-ring-2" />
                  <div className="af-pulse-ring af-pulse-ring-3" />
                </>
              )}
              <button
                onClick={generateMolecules}
                disabled={loading}
                className="af-btn-generate"
              >
                {loading ? (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <span className="af-loading-dots">
                      <span className="af-dot" />
                      <span className="af-dot" />
                      <span className="af-dot" />
                      <span style={{ marginLeft: 10, fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: "0.14em" }}>
                        SYNTHESIZING MOLECULES
                      </span>
                    </span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: "0.1em", color: "rgba(0,229,255,0.38)" }}>
                      this may take a bit 👉👈
                    </span>
                  </span>
                ) : (
                  "▶ Initiate Generation"
                )}
              </button>
            </div>
            {/* ── END GENERATE BUTTON ── */}

            {/* ── NOVEL MOLECULE NOTICE — visible only while loading ── */}
            {loading && (
              <div style={{
                marginTop:    "16px",
                padding:      "14px 18px",
                background:   "rgba(0,229,255,0.025)",
                border:       "1px solid rgba(0,229,255,0.09)",
                borderRadius: "12px",
                display:      "flex",
                alignItems:   "flex-start",
                gap:          "12px",
              }}>
                <span style={{ fontSize: "18px", flexShrink: 0, marginTop: "1px" }}></span>
                <p style={{
                  fontFamily:    "'Space Mono', monospace",
                  fontSize:      "10px",
                  color:         "rgba(208,238,247,0.38)",
                  lineHeight:    "1.8",
                  letterSpacing: "0.04em",
                  margin:        0,
                }}>
                  ⚛️Since these molecules are novel AI-generated candidates, we may not
                  be able to fetch their Common names & IUPAC names from public databases.
                </p>
              </div>
            )}

            <div className="af-space" />

            {/* ── RESULTS ── */}
            {molecules.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div className="af-sep" />
                <div className="af-results-header" style={{ marginBottom: 20 }}>
                  <div className="af-live-dot" />
                  <span>
                    {molecules.length} candidate{molecules.length !== 1 ? "s" : ""} generated
                    &nbsp;·&nbsp; property: {targetProperty}
                    &nbsp;·&nbsp; target: {targetValue}
                  </span>
                </div>

                <div className="af-mol-cards-space">
                  {molecules.map((m, idx) => (
                    <div
                      key={idx}
                      className="af-mol-card"
                      style={{ animation: `afCardIn 0.55s cubic-bezier(0.23,1,0.32,1) ${idx * 0.07}s both` }}
                    >

                      {/* ── LEFT COLUMN: info ── */}
                      <div>
                        <h3 className="af-mol-name">
                          {m.systematic_name
                            || m.iupac_name
                            || m.chemical_name
                            || m.name
                            || `Novel ${m.selected_property || targetProperty} Candidate`}
                        </h3>
                        <span className="af-badge">AI Generated · Candidate #{idx + 1}</span>

                        <div className="af-data">
                          <p className="af-data-row">
                            <span className="af-data-key">SMILES</span>{m.smiles}
                          </p>
                          <p className="af-data-row">
                            <span className="af-data-key">IUPAC Name</span>
                            {m.iupac_name || m.iupac
                              ? (m.iupac_name || m.iupac)
                              : <span style={{ opacity: 0.7 }}>can't find 🫠⚛️</span>}
                          </p>
                          <p className="af-data-row">
                            <span className="af-data-key">Common Name</span>
                            {m.common_name
                              ? m.common_name
                              : <span style={{ opacity: 0.7 }}>can't find 🫠⚛️</span>}
                          </p>
                          {m.formula && (
                            <p className="af-data-row">
                              <span className="af-data-key">Formula</span>{m.formula}
                            </p>
                          )}
                          {m.inchi && (
                            <p className="af-data-row" style={{ wordBreak: "break-all" }}>
                              <span className="af-data-key">InChI</span>
                              <span style={{ fontSize: "10px", opacity: 1.0 }}>{m.inchi}</span>
                            </p>
                          )}
                          {typeof m.error === "number" && (
                            <p className="af-data-row">
                              <span className="af-data-key">Error</span>{m.error.toFixed(4)}
                            </p>
                          )}
                        </div>

                        <div className="af-metrics">
                          <div className="af-metric">
                            <p className="af-metric-lbl">Property</p>
                            <p className="af-metric-val">{m.selected_property || targetProperty}</p>
                            {/* FEEDBACK SECTION */}
<div className="af-feedback">
  <h3>Feedback for this molecule</h3>

  <p className="af-feedback-subtitle">
    How would you rate this molecule?
  </p>

  <div className="af-rating">
    {[1, 2, 3, 4, 5].map((rating) => (
      <button
        key={rating}
        type="button"
        className={
          (feedback[idx]?.rating || 0) >= rating
            ? "af-star af-star-active"
            : "af-star"
        }
        onClick={() =>
          setFeedback((prev) => ({
            ...prev,
            [idx]: {
              rating,
              comment: prev[idx]?.comment || "",
            },
          }))
        }
        aria-label={`${rating} out of 5 stars`}
      >
        ★
      </button>
    ))}
  </div>

  <label className="af-label" htmlFor={`feedback-${idx}`}>
    Your comments
  </label>

  <textarea
    id={`feedback-${idx}`}
    className="af-feedback-input"
    placeholder="Share your thoughts about this molecule..."
    rows={3}
    value={feedback[idx]?.comment || ""}
    onChange={(e) =>
      setFeedback((prev) => ({
        ...prev,
        [idx]: {
          rating: prev[idx]?.rating || 0,
          comment: e.target.value,
        },
      }))
    }
  />

  <button
    type="button"
    className="af-feedback-submit"
    onClick={() => handleFeedbackSubmit(idx)}
  >
    Submit Feedback
  </button>
</div>
{/* END FEEDBACK SECTION */}
                          </div>
                          <div className="af-metric">
                            <p className="af-metric-lbl">Value</p>
                            <p className="af-metric-val">
                              {typeof m.predicted_property === "number"
                                ? m.predicted_property.toFixed(4)
                                : typeof m.predicted_value === "number"
                                  ? m.predicted_value.toFixed(4)
                                  : "—"}
                            </p>
                          </div>
                          <div className="af-metric af-metric-acc">
                            <p className="af-metric-lbl">Accuracy</p>
                            <p className="af-metric-val">
                              {typeof m.accuracy === "number"
                                ? m.accuracy > 1
                                  ? `${m.accuracy.toFixed(2)}%`
                                  : `${(m.accuracy * 100).toFixed(2)}%`
                                : "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* ── END LEFT COLUMN ── */}

                      {/* ── RIGHT COLUMN: image / 3D viewer ── */}
                      <div className="af-img-wrap">
                        {m.mol_3d_sdf && (
                          <button
                            className="af-view-toggle"
                            onClick={() =>
                              setView3D((prev) => ({ ...prev, [idx]: !prev[idx] }))
                            }
                          >
                            <span className="af-view-toggle-dot" />
                            {view3D[idx] ? "2D View" : "3D View"}
                          </button>
                        )}

                        {m.mol_3d_sdf && view3D[idx] ? (
                          <MolViewer sdfString={m.mol_3d_sdf} width={244} height={244} />
                        ) : (
                          <div className="af-img-box">
                            <img
                              src={
                                m.image_base64
                                  ? `data:image/png;base64,${m.image_base64}`
                                  : m.image || ""
                              }
                              alt={m.systematic_name || m.smiles}
                              className="af-mol-img"
                            />
                          </div>
                        )}
                      </div>
                      {/* ── END RIGHT COLUMN ── */}

                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}