'use client';

import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileCode2,
  FileJson,
  Image as ImageIcon,
  Upload,
  X,
} from 'lucide-react';
import { parseImportedDiagram, ParsedDiagramResult } from '@/lib/network/io';

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  diagramTitle: string;
  onChangeDiagramTitle: (title: string) => void;
  nodeCount: number;
  edgeCount: number;
  onExportJson: () => void;
  onExportSvg: () => void;
  onExportPng: () => Promise<void>;
  onCopyJson: () => Promise<boolean>;
  onImportDiagram: (data: ParsedDiagramResult) => void;
}

export function ImportExportModal({
  open,
  onClose,
  diagramTitle,
  onChangeDiagramTitle,
  nodeCount,
  edgeCount,
  onExportJson,
  onExportSvg,
  onExportPng,
  onCopyJson,
  onImportDiagram,
}: ImportExportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const [copied, setCopied] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);

  if (!open) return null;

  const processJsonText = (rawText: string) => {
    setImportError(null);
    const parsed = parseImportedDiagram(rawText);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    onImportDiagram(parsed);
    setPastedJson('');
    setShowPasteBox(false);
    onClose();
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImportError('Tệp quá lớn (tối đa 2 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      processJsonText(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      setImportError('Không thể đọc tệp đã chọn. Vui lòng thử lại.');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleCopy = async () => {
    const ok = await onCopyJson();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handlePngClick = async () => {
    setExportingPng(true);
    try {
      await onExportPng();
    } finally {
      setExportingPng(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="io-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2
              id="io-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              Nhập &amp; Xuất sơ đồ mạng
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              Hiện tại: {nodeCount} thiết bị · {edgeCount} kết nối
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-h-[80vh] overflow-y-auto space-y-6">
          {/* Diagram title for file naming */}
          <div>
            <label
              htmlFor="diagram-title-input"
              className="block text-xs font-semibold text-slate-800 mb-1.5"
            >
              Tên sơ đồ (dùng khi lưu tệp)
            </label>
            <input
              id="diagram-title-input"
              type="text"
              value={diagramTitle}
              onChange={(e) => onChangeDiagramTitle(e.target.value)}
              placeholder="Ví dụ: Sơ đồ mạng văn phòng"
              className="w-full h-9 px-3 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>

          {/* Export section */}
          <div className="space-y-3 pt-1 border-t border-slate-200">
            <div className="flex items-center justify-between pt-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Xuất sơ đồ (Export)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Lưu tệp JSON để chỉnh sửa lại sau, hoặc xuất ảnh PNG/SVG để gửi báo cáo.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={nodeCount === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Đã chép JSON</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép JSON</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={onExportJson}
                disabled={nodeCount === 0}
                className="flex flex-col items-start gap-1.5 p-3.5 rounded-lg border border-slate-200 hover:border-sky-600 hover:bg-sky-50/40 disabled:opacity-40 transition-colors text-left"
              >
                <div className="flex items-center justify-between w-full">
                  <FileJson className="w-4 h-4 text-sky-600" />
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="text-xs font-semibold text-slate-900">
                  Tệp dự án (.json)
                </div>
                <div className="text-[11px] text-slate-500 leading-snug">
                  Giữ đủ card mạng, DHCP, IP tĩnh để nhập lại.
                </div>
              </button>

              <button
                type="button"
                onClick={handlePngClick}
                disabled={nodeCount === 0 || exportingPng}
                className="flex flex-col items-start gap-1.5 p-3.5 rounded-lg border border-slate-200 hover:border-sky-600 hover:bg-sky-50/40 disabled:opacity-40 transition-colors text-left"
              >
                <div className="flex items-center justify-between w-full">
                  <ImageIcon className="w-4 h-4 text-emerald-600" />
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="text-xs font-semibold text-slate-900">
                  {exportingPng ? 'Đang xuất PNG...' : 'Ảnh PNG (.png)'}
                </div>
                <div className="text-[11px] text-slate-500 leading-snug">
                  Ảnh sắc nét dễ dán vào Word, Slide, Zalo.
                </div>
              </button>

              <button
                type="button"
                onClick={onExportSvg}
                disabled={nodeCount === 0}
                className="flex flex-col items-start gap-1.5 p-3.5 rounded-lg border border-slate-200 hover:border-sky-600 hover:bg-sky-50/40 disabled:opacity-40 transition-colors text-left"
              >
                <div className="flex items-center justify-between w-full">
                  <FileCode2 className="w-4 h-4 text-slate-700" />
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="text-xs font-semibold text-slate-900">
                  Ảnh Vector (.svg)
                </div>
                <div className="text-[11px] text-slate-500 leading-snug">
                  Phóng to không vỡ nét cho tài liệu kỹ thuật.
                </div>
              </button>
            </div>
          </div>

          {/* Import section */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Nhập sơ đồ từ tệp (Import)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Mở lại tệp <span className="font-mono">.json</span> đã xuất trước đó (có thể bấm Hoàn tác nếu muốn quay lại).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPasteBox((v) => !v);
                  setImportError(null);
                }}
                className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap shrink-0"
              >
                {showPasteBox ? 'Ẩn ô dán JSON' : 'Dán mã JSON'}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`p-5 rounded-xl border-2 border-dashed text-center cursor-pointer transition-colors ${
                isDraggingFile
                  ? 'border-sky-600 bg-sky-50/50'
                  : 'border-slate-200 hover:border-slate-400 bg-slate-50/60'
              }`}
            >
              <Upload className="w-5 h-5 text-slate-500 mx-auto mb-2" />
              <div className="text-xs font-semibold text-slate-800">
                Kéo thả tệp .json vào đây hoặc nhấn để chọn từ máy
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Hỗ trợ tệp JSON xuất từ NetFlow Studio (tối đa 2 MB)
              </div>
            </div>

            {showPasteBox && (
              <div className="space-y-2 pt-1">
                <textarea
                  rows={5}
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                  placeholder='Dán nội dung JSON sơ đồ mạng vào đây (ví dụ: { "nodes": [...], "edges": [...] })'
                  className="w-full p-3 text-xs font-mono text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:border-sky-600 focus:bg-white"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => processJsonText(pastedJson)}
                    disabled={!pastedJson.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Nhập từ mã JSON
                  </button>
                </div>
              </div>
            )}

            {importError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
