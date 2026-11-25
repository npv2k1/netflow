'use client';

import React, { useMemo, useState } from 'react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import { CATEGORY_LABELS, DEVICE_CATALOG } from '@/lib/network/catalog';
import { DeviceCategory, DeviceType } from '@/lib/network/types';
import { DeviceIcon } from './DeviceIcon';

interface DevicePaletteProps {
  onAddDeviceClick: (type: DeviceType) => void;
}

const CATEGORY_ORDER: DeviceCategory[] = [
  'gateway',
  'distribution',
  'endpoints',
  'servers',
];

export function DevicePalette({ onAddDeviceClick }: DevicePaletteProps) {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? DEVICE_CATALOG.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.shortName.toLowerCase().includes(q) ||
            item.simpleDesc.toLowerCase().includes(q)
        )
      : DEVICE_CATALOG;

    return CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: filtered.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const handleDragStart = (
    e: React.DragEvent<HTMLButtonElement>,
    type: DeviceType
  ) => {
    e.dataTransfer.setData('application/x-netflow-device', type);
    e.dataTransfer.setData('text/plain', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="w-[264px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full select-none">
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Kho thiết bị mạng
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            Kéo thả vào bảng vẽ hoặc nhấn trực tiếp để thêm thiết bị.
          </p>
        </div>

        <div className="relative">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm Gateway, DNS, Router..."
            aria-label="Tìm thiết bị mạng"
            className="w-full h-9 pl-9 pr-8 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600 focus:bg-white transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Xóa từ khóa tìm kiếm"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {grouped.length === 0 ? (
          <div className="py-10 px-3 text-center">
            <p className="text-xs text-slate-500">
              Không tìm thấy thiết bị phù hợp với &ldquo;{query}&rdquo;.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-2 text-xs font-medium text-sky-700 hover:underline"
            >
              Hiện tất cả thiết bị
            </button>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.category} className="space-y-1.5">
              <h3 className="px-2 text-xs font-semibold text-slate-500">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.type)}
                    onClick={() => onAddDeviceClick(item.type)}
                    title={`${item.name}: ${item.simpleDesc}`}
                    className="w-full group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left border border-transparent hover:border-slate-200 hover:bg-slate-50 active:bg-sky-50 transition-colors cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
                      style={{
                        backgroundColor: item.bgTint,
                        borderColor: item.borderTint,
                        color: item.accentColor,
                      }}
                    >
                      <DeviceIcon type={item.type} className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {item.shortName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {item.simpleDesc}
                      </div>
                    </div>
                    <span className="text-slate-300 group-hover:text-sky-600 shrink-0 transition-colors">
                      <Plus className="w-3.5 h-3.5 hidden group-hover:block" />
                      <GripVertical className="w-3.5 h-3.5 block group-hover:hidden" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3.5 border-t border-slate-200 bg-slate-50/70">
        <p className="text-[11px] text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-800">Mẹo nối dây nhanh:</span>{' '}
          Rê chuột lên thiết bị trên bảng vẽ rồi kéo từ chấm tròn ở cạnh sang thiết bị khác.
        </p>
      </div>
    </aside>
  );
}
