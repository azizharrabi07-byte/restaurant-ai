"use client";

import { useRef, useState } from "react";
import { Upload, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { downscaleImage } from "@/lib/image-utils";

interface ImageDropzoneProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  className?: string;
  /** "logo" renders square, "cover" renders wide banner, "wide" renders 16/9 */
  shape?: "logo" | "cover" | "wide";
  label?: string;
  hint?: string;
  presets?: { id: string; url: string; label?: string }[];
}

export function ImageDropzone({
  value,
  onChange,
  className,
  shape = "logo",
  label,
  hint,
  presets,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await downscaleImage(file);
    onChange(dataUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const aspectClass = {
    logo: "aspect-square max-w-[140px]",
    cover: "aspect-[21/9] w-full max-h-[160px]",
    wide: "aspect-[16/9] w-full max-h-[180px]",
  }[shape];

  return (
    <div className={cn("w-full flex flex-col gap-2 text-left", className)}>
      <div className="flex items-center justify-between">
        {label && (
          <label className="text-[11px] uppercase tracking-widest text-white/60 font-medium">
            {label}
          </label>
        )}
        {presets && presets.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPresets(!showPresets)}
            className="text-xs text-white/60 hover:text-white inline-flex items-center gap-1 font-medium transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{showPresets ? "Hide presets" : "Curated presets"}</span>
          </button>
        )}
      </div>

      {showPresets && presets && presets.length > 0 && (
        <div className="p-3 bg-[#0D0D0D] border border-white/10 rounded-lg mb-1">
          <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2 font-medium">
            Select a curated high-resolution sample image:
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.url);
                  setShowPresets(false);
                }}
                className={cn(
                  "relative rounded-md overflow-hidden border transition-all aspect-video group cursor-pointer",
                  value === p.url
                    ? "border-white ring-1 ring-white"
                    : "border-white/10 hover:border-white/30",
                )}
              >
                <img
                  src={p.url}
                  alt={p.label || "Preset"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  referrerPolicy="no-referrer"
                />
                <span className="absolute inset-x-0 bottom-0 bg-black/80 text-[8px] uppercase tracking-tight text-white/90 px-1 py-0.5 truncate text-center block">
                  {p.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {value ? (
        <div className="relative group inline-block">
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-white/10 bg-[#111111] relative shadow-sm",
              aspectClass,
            )}
          >
            <img
              src={value}
              alt="Uploaded asset"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#252525] text-white rounded-full text-xs font-medium border border-white/20 transition-colors cursor-pointer"
              >
                Change
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-full text-xs font-medium border border-red-500/30 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "border border-dashed rounded-lg p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 bg-white/[0.02] hover:border-white/20",
            isDragging ? "border-white bg-white/5" : "border-white/10",
            aspectClass,
          )}
        >
          <div className="w-9 h-9 rounded-full border border-white/20 bg-[#141414] flex items-center justify-center text-white/40 mb-2 group-hover:text-white transition-colors">
            <Upload className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-white/80">
            <span className="text-white font-semibold underline underline-offset-2">Click to upload</span>{" "}
            or drag &amp; drop
          </p>
          <p className="text-[10px] uppercase tracking-wider text-white/40 mt-1">PNG, JPG or WebP</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {hint && <p className="text-xs text-white/40">{hint}</p>}
    </div>
  );
}