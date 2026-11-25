'use client';

import React from 'react';
import {
  AlertTriangle,
  Cable,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import {
  CONNECTION_META,
  DEVICE_CATALOG,
  DEVICE_CATALOG_MAP,
} from '@/lib/network/catalog';
import {
  getDefaultDhcpPool,
  getEffectiveNodeNics,
} from '@/lib/network/simulation';
import {
  ConnectionType,
  DeviceType,
  DhcpPoolConfig,
  IpAssignmentMode,
  NetworkEdge,
  NetworkInterface,
  NetworkNode,
  ResolvedNicState,
} from '@/lib/network/types';
import { DeviceIcon } from './DeviceIcon';

interface InspectorPanelProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  resolvedNicsMap: Map<string, ResolvedNicState[]>;
  selectedNode: NetworkNode | null;
  selectedEdge: NetworkEdge | null;
  onUpdateNode: (id: string, patch: Partial<NetworkNode>) => void;
  onDeleteNode: (id: string) => void;
  onUpdateEdge: (id: string, patch: Partial<NetworkEdge>) => void;
  onDeleteEdge: (id: string) => void;
}

export function InspectorPanel({
  nodes,
  edges,
  resolvedNicsMap,
  selectedNode,
  selectedEdge,
  onUpdateNode,
  onDeleteNode,
  onUpdateEdge,
  onDeleteEdge,
}: InspectorPanelProps) {
  if (selectedNode) {
    const catalog = DEVICE_CATALOG_MAP[selectedNode.type];
    const connectedEdges = edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
    const supportsMultiNic = Boolean(catalog.supportsMultiNic);
    const supportsDhcp = Boolean(catalog.supportsDhcpServer);
    const nics = supportsMultiNic
      ? getEffectiveNodeNics(selectedNode, edges)
      : [];
    const resolvedList = resolvedNicsMap.get(selectedNode.id) ?? [];
    const dhcpPool = supportsDhcp ? getDefaultDhcpPool(selectedNode) : null;

    const commitNics = (nextNics: NetworkInterface[]) => {
      const primaryStaticIp = nextNics[0]?.staticIp || selectedNode.ip;
      onUpdateNode(selectedNode.id, {
        nics: nextNics,
        ip: primaryStaticIp,
      });
    };

    const handleAddNic = () => {
      let nextIdx = nics.length + 1;
      while (nics.some((n) => n.id === `${selectedNode.id}-nic-${nextIdx}`)) {
        nextIdx += 1;
      }
      const newNic: NetworkInterface = {
        id: `${selectedNode.id}-nic-${nextIdx}`,
        name: `Card mạng ${nextIdx}`,
        ipMode: 'dhcp',
        staticIp: `192.168.${nextIdx}.10`,
        subnetMask: '255.255.255.0',
        gateway: `192.168.${nextIdx}.1`,
      };
      commitNics([...nics, newNic]);
    };

    const handleUpdateNic = (
      nicId: string,
      patch: Partial<NetworkInterface>
    ) => {
      const nextNics = nics.map((nic) =>
        nic.id === nicId ? { ...nic, ...patch } : nic
      );
      commitNics(nextNics);
    };

    const handleRemoveNic = (nicId: string) => {
      if (nics.length <= 1) return;
      const nextNics = nics.filter((nic) => nic.id !== nicId);
      commitNics(nextNics);
      // Unbind any edge pointing to the removed NIC
      connectedEdges.forEach((edge) => {
        if (edge.source === selectedNode.id && edge.sourceNicId === nicId) {
          onUpdateEdge(edge.id, { sourceNicId: undefined });
        } else if (
          edge.target === selectedNode.id &&
          edge.targetNicId === nicId
        ) {
          onUpdateEdge(edge.id, { targetNicId: undefined });
        }
      });
    };

    const handleUpdateDhcp = (patch: Partial<DhcpPoolConfig>) => {
      if (!dhcpPool) return;
      onUpdateNode(selectedNode.id, {
        dhcpPool: { ...dhcpPool, ...patch },
      });
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border"
            style={{
              backgroundColor: catalog.bgTint,
              borderColor: catalog.borderTint,
              color: catalog.accentColor,
            }}
          >
            <DeviceIcon type={selectedNode.type} className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {selectedNode.label}
            </h3>
            <div className="text-xs text-slate-500">
              {catalog.name} ·{' '}
              <span className="font-mono tabular-nums">
                {connectedEdges.length} dây nối
              </span>
            </div>
          </div>
        </div>

        {/* Plain-language explanation */}
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
          <div className="text-[11px] font-semibold text-slate-800">
            Thiết bị này làm gì?
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {catalog.simpleDesc} {catalog.roleAnalogy}
          </p>
        </div>

        {/* Basic properties */}
        <div className="space-y-3.5">
          <div>
            <label
              htmlFor="node-label-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Tên hiển thị
            </label>
            <input
              id="node-label-input"
              type="text"
              value={selectedNode.label}
              onChange={(e) =>
                onUpdateNode(selectedNode.id, { label: e.target.value })
              }
              className="w-full h-9 px-3 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>

          <div>
            <label
              htmlFor="node-type-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Loại thiết bị
            </label>
            <select
              id="node-type-select"
              value={selectedNode.type}
              onChange={(e) =>
                onUpdateNode(selectedNode.id, {
                  type: e.target.value as DeviceType,
                  blockThreats:
                    e.target.value === 'firewall'
                      ? true
                      : selectedNode.blockThreats,
                })
              }
              className="w-full h-9 px-2.5 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            >
              {DEVICE_CATALOG.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {!supportsMultiNic && (
            <div>
              <label
                htmlFor="node-ip-input"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Địa chỉ IP
              </label>
              <input
                id="node-ip-input"
                type="text"
                value={selectedNode.ip}
                onChange={(e) =>
                  onUpdateNode(selectedNode.id, { ip: e.target.value })
                }
                className="w-full h-9 px-3 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              />
            </div>
          )}
        </div>

        {/* Multi-NIC Management Section for PC / Laptop / Server / NAS / Endpoints */}
        {supportsMultiNic && (
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-slate-900">
                  Card mạng &amp; Địa chỉ IP ({nics.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Gắn nhiều card để nối cùng lúc nhiều mạng khác nhau.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddNic}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm card</span>
              </button>
            </div>

            <div className="space-y-3">
              {nics.map((nic) => {
                const resolved = resolvedList.find((r) => r.nicId === nic.id);
                const isDhcp = nic.ipMode === 'dhcp';

                return (
                  <div
                    key={nic.id}
                    className="p-3 rounded-lg bg-slate-50/80 border border-slate-200 space-y-2.5"
                  >
                    {/* NIC Header */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={nic.name}
                        onChange={(e) =>
                          handleUpdateNic(nic.id, { name: e.target.value })
                        }
                        aria-label="Tên card mạng"
                        className="flex-1 min-w-0 h-7 px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                      />
                      {nics.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveNic(nic.id)}
                          title="Xóa card mạng này"
                          aria-label={`Xóa ${nic.name}`}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Connection status line */}
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <Cable className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {resolved?.connected && resolved.peerLabel
                          ? `Đang nối: ${resolved.peerLabel}`
                          : resolved?.statusNote || 'Chưa nối vào mạng nào'}
                      </span>
                    </div>

                    {/* DHCP vs Manual Static toggle */}
                    <div className="grid grid-cols-2 p-0.5 bg-slate-200/70 rounded-md">
                      {(['dhcp', 'static'] as IpAssignmentMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            handleUpdateNic(nic.id, { ipMode: mode })
                          }
                          className={`py-1 px-2 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                            nic.ipMode === mode
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {mode === 'dhcp' ? 'Tự động (DHCP)' : 'Cấu hình tay'}
                        </button>
                      ))}
                    </div>

                    {isDhcp ? (
                      <div className="space-y-1 text-xs">
                        {resolved?.connected && resolved.effectiveIp ? (
                          <div className="p-2 rounded-md bg-white border border-slate-200 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-slate-500">
                                IP được cấp
                              </span>
                              <span className="font-mono tabular-nums font-semibold text-sky-700">
                                {resolved.effectiveIp}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                              <span>Mask: {resolved.subnetMask}</span>
                              {resolved.gateway && (
                                <span>GW: {resolved.gateway}</span>
                              )}
                            </div>
                            {resolved.dhcpProviderLabel && (
                              <div className="text-[10.5px] text-slate-500 pt-0.5 border-t border-slate-100">
                                Nguồn cấp: {resolved.dhcpProviderLabel}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-1.5 leading-snug">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span>
                              {resolved?.statusNote ||
                                'Chưa có địa chỉ IP. Hãy nối dây vào mạng có DHCP hoặc chuyển sang Cấu hình tay.'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-0.5">
                            Địa chỉ IP tĩnh
                          </label>
                          <input
                            type="text"
                            value={nic.staticIp}
                            onChange={(e) =>
                              handleUpdateNic(nic.id, {
                                staticIp: e.target.value,
                              })
                            }
                            placeholder="192.168.1.20"
                            className="w-full h-8 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-600 mb-0.5">
                              Subnet Mask
                            </label>
                            <input
                              type="text"
                              value={nic.subnetMask}
                              onChange={(e) =>
                                handleUpdateNic(nic.id, {
                                  subnetMask: e.target.value,
                                })
                              }
                              className="w-full h-8 px-2 text-[11px] font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-600 mb-0.5">
                              Gateway
                            </label>
                            <input
                              type="text"
                              value={nic.gateway ?? ''}
                              onChange={(e) =>
                                handleUpdateNic(nic.id, {
                                  gateway: e.target.value,
                                })
                              }
                              placeholder="192.168.1.1"
                              className="w-full h-8 px-2 text-[11px] font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DHCP Server / Router Pool Settings */}
        {supportsDhcp && dhcpPool && (
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-slate-900">
                  Dịch vụ cấp IP tự động (DHCP)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Tự động gán IP cho các máy tính nối vào mạng này.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleUpdateDhcp({ enabled: !dhcpPool.enabled })
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  dhcpPool.enabled
                    ? 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                {dhcpPool.enabled ? 'Đang bật' : 'Đã tắt'}
              </button>
            </div>

            {dhcpPool.enabled && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-0.5">
                    Dải mạng (3 số đầu IP)
                  </label>
                  <input
                    type="text"
                    value={dhcpPool.networkPrefix}
                    onChange={(e) =>
                      handleUpdateDhcp({ networkPrefix: e.target.value })
                    }
                    placeholder="192.168.1"
                    className="w-full h-8 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">
                      Cấp từ số
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={250}
                      value={dhcpPool.startHost}
                      onChange={(e) =>
                        handleUpdateDhcp({
                          startHost: Math.max(2, Number(e.target.value) || 100),
                        })
                      }
                      className="w-full h-8 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-0.5">
                      Đến số
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={254}
                      value={dhcpPool.endHost}
                      onChange={(e) =>
                        handleUpdateDhcp({
                          endHost: Math.min(254, Number(e.target.value) || 200),
                        })
                      }
                      className="w-full h-8 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-0.5">
                    Gateway cấp kèm
                  </label>
                  <input
                    type="text"
                    value={dhcpPool.gatewayIp}
                    onChange={(e) =>
                      handleUpdateDhcp({ gatewayIp: e.target.value })
                    }
                    className="w-full h-8 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-sky-600"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Power & Firewall toggles */}
        <div className="pt-3 border-t border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-900">
                Trạng thái hoạt động
              </div>
              <div className="text-[11px] text-slate-500">
                Tắt thử để kiểm tra mạng có bị gián đoạn không.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateNode(selectedNode.id, {
                  status:
                    selectedNode.status === 'active' ? 'offline' : 'active',
                })
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                selectedNode.status === 'active'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>
                {selectedNode.status === 'active' ? 'Đang bật' : 'Đang tắt'}
              </span>
            </button>
          </div>

          {selectedNode.type === 'firewall' && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <div>
                <div className="text-xs font-medium text-slate-900">
                  Chặn gói tin lạ
                </div>
                <div className="text-[11px] text-slate-500">
                  Tự động ngăn truy cập bất thường khi chạy mô phỏng.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateNode(selectedNode.id, {
                    blockThreats: selectedNode.blockThreats === false,
                  })
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  selectedNode.blockThreats !== false
                    ? 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>
                  {selectedNode.blockThreats !== false ? 'Đang bảo vệ' : 'Đã tắt'}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-auto pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onDeleteNode(selectedNode.id)}
            className="w-full h-9 px-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa thiết bị này</span>
          </button>
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    const sourceNode = nodes.find((n) => n.id === selectedEdge.source);
    const targetNode = nodes.find((n) => n.id === selectedEdge.target);
    const sourceNics = sourceNode
      ? getEffectiveNodeNics(sourceNode, edges)
      : [];
    const targetNics = targetNode
      ? getEffectiveNodeNics(targetNode, edges)
      : [];

    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5">
        <div className="pb-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Chi tiết đường kết nối
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {sourceNode?.label ?? 'Thiết bị A'} ↔{' '}
            {targetNode?.label ?? 'Thiết bị B'}
          </p>
        </div>

        <div className="space-y-4">
          {/* NIC port assignment if either end has multiple NICs */}
          {sourceNode && sourceNics.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cắm vào card mạng của {sourceNode.label}
              </label>
              <select
                value={selectedEdge.sourceNicId ?? ''}
                onChange={(e) =>
                  onUpdateEdge(selectedEdge.id, {
                    sourceNicId: e.target.value || undefined,
                  })
                }
                className="w-full h-9 px-2.5 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              >
                <option value="">Tự động chọn card trống</option>
                {sourceNics.map((nic) => (
                  <option key={nic.id} value={nic.id}>
                    {nic.name} ({nic.ipMode === 'dhcp' ? 'DHCP' : nic.staticIp})
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetNode && targetNics.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cắm vào card mạng của {targetNode.label}
              </label>
              <select
                value={selectedEdge.targetNicId ?? ''}
                onChange={(e) =>
                  onUpdateEdge(selectedEdge.id, {
                    targetNicId: e.target.value || undefined,
                  })
                }
                className="w-full h-9 px-2.5 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
              >
                <option value="">Tự động chọn card trống</option>
                {targetNics.map((nic) => (
                  <option key={nic.id} value={nic.id}>
                    {nic.name} ({nic.ipMode === 'dhcp' ? 'DHCP' : nic.staticIp})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">
              Loại đường truyền
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {(['fiber', 'ethernet', 'wifi'] as ConnectionType[]).map((ct) => {
                const meta = CONNECTION_META[ct];
                const isSelected = selectedEdge.type === ct;
                return (
                  <button
                    key={ct}
                    type="button"
                    onClick={() =>
                      onUpdateEdge(selectedEdge.id, {
                        type: ct,
                        bandwidth: meta.defaultBandwidth,
                      })
                    }
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50 font-semibold text-slate-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-5 inline-block"
                        style={{
                          borderTop: `2.5px ${
                            meta.dashArray ? 'dashed' : 'solid'
                          } ${meta.stroke}`,
                        }}
                      />
                      <span>{meta.label}</span>
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      ~{meta.latencyMs}ms
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="edge-bw-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Tốc độ / Băng thông
            </label>
            <input
              id="edge-bw-input"
              type="text"
              value={selectedEdge.bandwidth}
              onChange={(e) =>
                onUpdateEdge(selectedEdge.id, { bandwidth: e.target.value })
              }
              className="w-full h-9 px-3 text-xs font-mono text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
            />
          </div>

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-900">
                Tình trạng dây nối
              </div>
              <div className="text-[11px] text-slate-500">
                Thử ngắt dây để xem gói tin có tìm đường dự phòng không.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateEdge(selectedEdge.id, {
                  status: selectedEdge.status === 'active' ? 'down' : 'active',
                })
              }
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                selectedEdge.status === 'active'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              }`}
            >
              {selectedEdge.status === 'active' ? 'Thông suốt' : 'Bị đứt'}
            </button>
          </div>
        </div>

        <div className="mt-auto pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onDeleteEdge(selectedEdge.id)}
            className="w-full h-9 px-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
          >
            <Unlink className="w-3.5 h-3.5" />
            <span>Ngắt kết nối này</span>
          </button>
        </div>
      </div>
    );
  }

  // Default overview
  const activeDevices = nodes.filter((n) => n.status === 'active').length;
  const activeEdges = edges.filter((e) => e.status === 'active').length;
  const wifiLinks = edges.filter((e) => e.type === 'wifi').length;
  const wiredLinks = edges.length - wifiLinks;

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">
          Tổng quan sơ đồ
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Nhấn vào bất kỳ thiết bị nào để cấu hình nhiều card mạng (DHCP hoặc IP tĩnh), chỉnh dải cấp phát DHCP trên Router/DHCP Server hoặc thử tắt nguồn.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-[11px] text-slate-500">Thiết bị hoạt động</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
            {activeDevices}/{nodes.length}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-[11px] text-slate-500">Kết nối thông suốt</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
            {activeEdges}/{edges.length}
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-slate-200 text-xs text-slate-600">
        <div className="flex items-center justify-between">
          <span>Đường dây cáp (Quang / LAN)</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {wiredLinks}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Kết nối không dây Wi-Fi</span>
          <span className="font-mono tabular-nums font-medium text-slate-900">
            {wifiLinks}
          </span>
        </div>
      </div>

      <div className="space-y-2 pt-3 border-t border-slate-200">
        <div className="text-xs font-semibold text-slate-900">
          Mẹo nối PC vào nhiều mạng
        </div>
        <ol className="space-y-2 text-xs text-slate-600 leading-relaxed list-decimal list-inside">
          <li>
            Kéo dây nối từ <span className="font-medium text-slate-800">PC</span> sang nhiều Switch/Router khác nhau — hệ thống tự gắn thêm Card mạng mới.
          </li>
          <li>
            Chọn PC để chuyển từng card giữa <span className="font-medium text-slate-800">Tự động (DHCP)</span> và <span className="font-medium text-slate-800">Cấu hình tay</span>.
          </li>
          <li>
            Khi mô phỏng, tất cả IP đang kết nối của máy sẽ hiện rõ trên bảng vẽ và từng chặng gói tin.
          </li>
        </ol>
      </div>
    </div>
  );
}
