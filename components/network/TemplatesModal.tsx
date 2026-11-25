'use client';

import React from 'react';
import { ArrowRight, X } from 'lucide-react';
import { NETWORK_TEMPLATES } from '@/lib/network/catalog';
import { NetworkTemplate } from '@/lib/network/types';

interface TemplatesModalProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: NetworkTemplate) => void;
}

export function TemplatesModal({
  open,
  onClose,
  onSelectTemplate,
}: TemplatesModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="templates-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2
              id="templates-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              Chọn sơ đồ mạng mẫu
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Bắt đầu nhanh từ các mô hình thực tế, sau đó tự do kéo thả chỉnh sửa theo ý bạn.
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

        <div className="p-6 max-h-[75vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {NETWORK_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                onSelectTemplate(tpl);
                onClose();
              }}
              className="group text-left p-4 rounded-xl border border-slate-200 hover:border-sky-600 hover:bg-sky-50/30 transition-colors flex flex-col justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-sky-800">
                    {tpl.name}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-sky-600 shrink-0 transition-colors" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {tpl.subtitle}
                </p>
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                {tpl.audience} · {tpl.nodes.length} thiết bị · {tpl.edges.length} kết nối
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
