'use client';

import React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Crosshair,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { CONNECTION_META, PACKET_SCENARIOS } from '@/lib/network/catalog';
import {
  ComputedPacketFlow,
  NetworkNode,
  PacketScenarioId,
  ResolvedNicState,
} from '@/lib/network/types';

interface PacketFlowPanelProps {
  nodes: NetworkNode[];
  resolvedNicsMap: Map<string, ResolvedNicState[]>;
  sourceId: string;
  targetId: string;
  scenarioId: PacketScenarioId;
  onChangeSource: (id: string) => void;
  onChangeTarget: (id: string) => void;
  onSwapEndpoints: () => void;
  onChangeScenario: (id: PacketScenarioId) => void;
  pickTargetMode: 'source' | 'target' | null;
  onSetPickTargetMode: (mode: 'source' | 'target' | null) => void;
  computedFlow: ComputedPacketFlow | null;
  isSimulating: boolean;
  onTogglePlay: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onReset: () => void;
  activeStepIndex: number;
  onJumpToStep: (idx: number) => void;
  speed: number;
  onChangeSpeed: (val: number) => void;
}

function formatNodeOptionIps(
  node: NetworkNode,
  resolvedNicsMap: Map<string, ResolvedNicState[]>
): string {
  const nics = resolvedNicsMap.get(node.id);
  if (!nics || nics.length === 0) return node.ip;
  const activeIps = nics
    .filter((n) => n.connected && n.effectiveIp)
    .map((n) => n.effectiveIp!);
  if (activeIps.length === 0) return 'Chưa có IP';
  return activeIps.join(', ');
}

export function PacketFlowPanel({
  nodes,
  resolvedNicsMap,
  sourceId,
  targetId,
  scenarioId,
  onChangeSource,
  onChangeTarget,
  onSwapEndpoints,
  onChangeScenario,
  pickTargetMode,
  onSetPickTargetMode,
  computedFlow,
  isSimulating,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onReset,
  activeStepIndex,
  onJumpToStep,
  speed,
  onChangeSpeed,
}: PacketFlowPanelProps) {
  const hasHops = Boolean(computedFlow && computedFlow.hops.length > 0);
  const currentHop = hasHops
    ? computedFlow!.hops[Math.min(activeStepIndex, computedFlow!.hops.length - 1)]
    : null;

  const sourceNode = nodes.find((n) => n.id === sourceId);
  const targetNode = nodes.find((n) => n.id === targetId);
  const sourceResolvedNics = sourceId
    ? (resolvedNicsMap.get(sourceId) ?? []).filter((n) => n.connected)
    : [];
  const targetResolvedNics = targetId
    ? (resolvedNicsMap.get(targetId) ?? []).filter((n) => n.connected)
    : [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Endpoints selection */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-900">
            Chọn điểm gửi &amp; điểm nhận
          </h3>
          <button
            type="button"
            onClick={onSwapEndpoints}
            disabled={!sourceId || !targetId}
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 disabled:opacity-40 whitespace-nowrap"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Đổi chiều</span>
          </button>
        </div>

        <div className="space-y-2.5">
          <div>
            <label
              htmlFor="sim-source-select"
              className="block text-[11px] font-medium text-slate-600 mb-1"
            >
              Thiết bị gửi gói tin
            </label>
            <div className="flex items-center gap-1.5">
              <select
                id="sim-source-select"
                value={sourceId}
                onChange={(e) => onChangeSource(e.target.value)}
                className="flex-1 min-w-0 h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
              >
                <option value="">-- Chọn thiết bị gửi --</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({formatNodeOptionIps(n, resolvedNicsMap)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  onSetPickTargetMode(
                    pickTargetMode === 'source' ? null : 'source'
                  )
                }
                title="Chọn trực tiếp trên sơ đồ"
                aria-label="Chọn thiết bị gửi trên sơ đồ"
                className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  pickTargetMode === 'source'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="sim-target-select"
              className="block text-[11px] font-medium text-slate-600 mb-1"
            >
              Thiết bị nhận gói tin
            </label>
            <div className="flex items-center gap-1.5">
              <select
                id="sim-target-select"
                value={targetId}
                onChange={(e) => onChangeTarget(e.target.value)}
                className="flex-1 min-w-0 h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-sky-600"
              >
                <option value="">-- Chọn thiết bị nhận --</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({formatNodeOptionIps(n, resolvedNicsMap)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  onSetPickTargetMode(
                    pickTargetMode === 'target' ? null : 'target'
                  )
                }
                title="Chọn trực tiếp trên sơ đồ"
                aria-label="Chọn thiết bị nhận trên sơ đồ"
                className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                  pickTargetMode === 'target'
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* All connected IPs summary for selected source & destination */}
        {(sourceResolvedNics.length > 0 || targetResolvedNics.length > 0) && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="text-[11px] font-semibold text-slate-700">
              Tất cả IP đang kết nối
            </div>
            {sourceNode && sourceResolvedNics.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[11px] font-medium text-slate-600">
                  Máy gửi: {sourceNode.label}
                </div>
                {sourceResolvedNics.map((nic) => (
                  <div
                    key={nic.nicId}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums pl-2"
                  >
                    <span className="text-slate-600 font-sans truncate">
                      {nic.nicName}
                    </span>
                    <span
                      className={
                        nic.effectiveIp
                          ? 'text-slate-900 font-medium shrink-0'
                          : 'text-amber-700 shrink-0'
                      }
                    >
                      {nic.effectiveIp ?? 'Chờ DHCP'} ·{' '}
                      <span className="font-sans text-[10px] text-sky-700">
                        {nic.ipMode === 'dhcp' ? 'DHCP' : 'Tĩnh'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {targetNode && targetResolvedNics.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[11px] font-medium text-slate-600">
                  Máy nhận: {targetNode.label}
                </div>
                {targetResolvedNics.map((nic) => (
                  <div
                    key={nic.nicId}
                    className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums pl-2"
                  >
                    <span className="text-slate-600 font-sans truncate">
                      {nic.nicName}
                    </span>
                    <span
                      className={
                        nic.effectiveIp
                          ? 'text-slate-900 font-medium shrink-0'
                          : 'text-amber-700 shrink-0'
                      }
                    >
                      {nic.effectiveIp ?? 'Chờ DHCP'} ·{' '}
                      <span className="font-sans text-[10px] text-sky-700">
                        {nic.ipMode === 'dhcp' ? 'DHCP' : 'Tĩnh'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scenario picker */}
      <div className="p-4 border-b border-slate-200 space-y-2.5">
        <h3 className="text-xs font-semibold text-slate-900">
          Kịch bản gói tin
        </h3>
        <div className="grid grid-cols-1 gap-1.5">
          {PACKET_SCENARIOS.map((sc) => {
            const active = sc.id === scenarioId;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => onChangeScenario(sc.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                  active
                    ? 'border-slate-900 bg-slate-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {sc.name}
                  </span>
                  <span
                    className="text-[11px] font-mono font-semibold shrink-0"
                    style={{ color: sc.color }}
                  >
                    {sc.protocol}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  {sc.summary}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Playback controls */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasHops}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
          >
            {isSimulating ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Tạm dừng</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Chạy mô phỏng</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onStepBack}
            disabled={!hasHops || activeStepIndex <= 0}
            title="Lùi 1 chặng"
            aria-label="Lùi 1 chặng"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onStepForward}
            disabled={
              !hasHops ||
              activeStepIndex >= (computedFlow?.hops.length ?? 1) - 1
            }
            title="Tiến 1 chặng"
            aria-label="Tiến 1 chặng"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onReset}
            disabled={!hasHops}
            title="Chạy lại từ đầu"
            aria-label="Chạy lại từ đầu"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Labeled Speed Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label
              htmlFor="sim-speed-slider"
              className="text-slate-600 font-medium"
            >
              Tốc độ di chuyển gói tin
            </label>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {speed.toFixed(1)}x
            </span>
          </div>
          <input
            id="sim-speed-slider"
            type="range"
            min={0.5}
            max={2.0}
            step={0.5}
            value={speed}
            onChange={(e) => onChangeSpeed(parseFloat(e.target.value))}
            className="w-full accent-sky-600 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
            <span>0.5x (Chậm)</span>
            <span>1.0x</span>
            <span>1.5x</span>
            <span>2.0x (Nhanh)</span>
          </div>
        </div>
      </div>

      {/* Results & Hop-by-hop Narrative */}
      <div className="p-4 flex-1 space-y-3">
        {!computedFlow || (!hasHops && computedFlow.errorMessage) ? (
          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Chưa thể truyền gói tin</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-800">
              {computedFlow?.errorMessage ||
                'Hãy chọn thiết bị gửi và thiết bị nhận để xem đường đi gói tin.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                {computedFlow.blockedAtNodeId ? (
                  <>
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-red-700">
                      Tường lửa đã chặn gói tin lạ
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">
                      Đường truyền thông suốt
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>{computedFlow.hops.length} chặng</span>
                <span aria-hidden="true">·</span>
                <span>Tổng trễ ~{computedFlow.totalLatencyMs} ms</span>
                <span aria-hidden="true">·</span>
                <span>
                  Bước {Math.min(activeStepIndex + 1, computedFlow.hops.length)}/
                  {computedFlow.hops.length}
                </span>
              </div>
            </div>

            {currentHop && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="text-xs font-semibold text-slate-900">
                  Chặng {currentHop.stepIndex + 1}: {currentHop.actionTitle}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {currentHop.explanation}
                </p>
                {currentHop.allConnectedIps &&
                  currentHop.allConnectedIps.length > 1 && (
                    <div className="pt-1.5 border-t border-slate-200/80 space-y-0.5">
                      <div className="text-[10.5px] font-medium text-slate-500">
                        Các IP đang kết nối của {currentHop.nodeLabel}:
                      </div>
                      {currentHop.allConnectedIps.map((item, i) => (
                        <div
                          key={i}
                          className={`text-[11px] font-mono tabular-nums flex items-center justify-between ${
                            item.ip === currentHop.nodeIp
                              ? 'text-sky-700 font-semibold'
                              : 'text-slate-600'
                          }`}
                        >
                          <span className="font-sans truncate pr-2">
                            {item.nicName}
                            {item.ip === currentHop.nodeIp ? ' (đang dùng)' : ''}
                          </span>
                          <span className="shrink-0">
                            {item.ip} ({item.ipMode === 'dhcp' ? 'DHCP' : 'Tĩnh'})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}

            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-semibold text-slate-500 pb-1">
                Chi tiết hành trình từng thiết bị
              </div>
              {computedFlow.hops.map((hop, idx) => {
                const isActive = idx === activeStepIndex;
                const isPast = idx < activeStepIndex;
                const edgeMeta = hop.edgeType
                  ? CONNECTION_META[hop.edgeType]
                  : null;

                return (
                  <button
                    key={`${hop.nodeId}-${idx}`}
                    type="button"
                    onClick={() => onJumpToStep(idx)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      isActive
                        ? 'bg-sky-50/70 border-sky-300'
                        : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full text-[11px] font-mono tabular-nums font-semibold flex items-center justify-center shrink-0 ${
                            hop.status === 'blocked'
                              ? 'bg-red-600 text-white'
                              : isActive
                              ? 'bg-sky-600 text-white'
                              : isPast
                              ? 'bg-slate-800 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {hop.nodeLabel}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                        {hop.latencyMs > 0 ? `+${hop.latencyMs}ms` : 'Xuất phát'}
                      </span>
                    </div>
                    <div className="pl-7 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="font-mono tabular-nums text-slate-700">
                        {hop.nodeIp}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {hop.direction === 'outbound' ? 'Chiều đi' : 'Phản hồi'}
                      </span>
                      {edgeMeta && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Qua {edgeMeta.shortLabel}</span>
                        </>
                      )}
                      {hop.status === 'blocked' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-red-600 font-medium">
                            Đã chặn
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
