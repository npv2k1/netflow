'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cable,
  LayoutGrid,
  Maximize2,
  MousePointer2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CONNECTION_META, DEVICE_CATALOG_MAP } from '@/lib/network/catalog';
import {
  ComputedPacketFlow,
  DeviceType,
  NetworkEdge,
  NetworkNode,
  ResolvedNicState,
} from '@/lib/network/types';
import { DeviceIcon } from './DeviceIcon';

export const NODE_WIDTH = 196;
export const BASE_NODE_HEIGHT = 76;

export function getNodeHeight(
  node: NetworkNode,
  resolvedNicsMap: Map<string, ResolvedNicState[]>
): number {
  const nics = resolvedNicsMap.get(node.id);
  if (!nics || nics.length === 0) return BASE_NODE_HEIGHT;
  const connected = nics.filter((r) => r.connected);
  const shownRows = Math.max(1, connected.length);
  if (shownRows === 1) return 82;
  return 58 + shownRows * 20;
}

interface NetworkCanvasProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  resolvedNicsMap: Map<string, ResolvedNicState[]>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  interactionMode: 'select' | 'connect';
  setInteractionMode: (mode: 'select' | 'connect') => void;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onMoveNodeEnd: () => void;
  onDropNewDevice: (type: DeviceType, x: number, y: number) => void;
  onConnectNodes: (sourceId: string, targetId: string) => void;
  onAutoLayout: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onClearCanvas: () => void;
  onOpenTemplates: () => void;
  aiEnabled?: boolean;
  onFocusAi?: () => void;
  // Simulation visual props
  computedFlow: ComputedPacketFlow | null;
  isSimulating: boolean;
  activeStepIndex: number;
  segmentProgress: number;
  showSimulationOverlay: boolean;
  simSourceId: string;
  simTargetId: string;
  pickTargetMode: 'source' | 'target' | null;
  onPickSimNode: (nodeId: string) => void;
}

interface Point {
  x: number;
  y: number;
}

function getEdgePathData(
  source: NetworkNode,
  target: NetworkNode,
  sourceHeight: number,
  targetHeight: number
) {
  const sx = source.x + NODE_WIDTH / 2;
  const sy = source.y + sourceHeight / 2;
  const tx = target.x + NODE_WIDTH / 2;
  const ty = target.y + targetHeight / 2;
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);

  let cx1: number;
  let cy1: number;
  let cx2: number;
  let cy2: number;

  if (dx >= dy) {
    const curve = Math.max(48, dx * 0.42);
    cx1 = sx <= tx ? sx + curve : sx - curve;
    cy1 = sy;
    cx2 = sx <= tx ? tx - curve : tx + curve;
    cy2 = ty;
  } else {
    const curve = Math.max(48, dy * 0.42);
    cx1 = sx;
    cy1 = sy <= ty ? sy + curve : sy - curve;
    cx2 = tx;
    cy2 = sy <= ty ? ty - curve : ty + curve;
  }

  return {
    sx,
    sy,
    cx1,
    cy1,
    cx2,
    cy2,
    tx,
    ty,
    d: `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`,
    midX: 0.125 * sx + 0.375 * cx1 + 0.375 * cx2 + 0.125 * tx,
    midY: 0.125 * sy + 0.375 * cy1 + 0.375 * cy2 + 0.125 * ty,
  };
}

function evalCubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

export function NetworkCanvas({
  nodes,
  edges,
  resolvedNicsMap,
  selectedNodeId,
  selectedEdgeId,
  interactionMode,
  setInteractionMode,
  onSelectNode,
  onSelectEdge,
  onMoveNode,
  onMoveNodeEnd,
  onDropNewDevice,
  onConnectNodes,
  onAutoLayout,
  onUndo,
  canUndo,
  onClearCanvas,
  onOpenTemplates,
  aiEnabled = false,
  onFocusAi,
  computedFlow,
  isSimulating,
  activeStepIndex,
  segmentProgress,
  showSimulationOverlay,
  simSourceId,
  simTargetId,
  pickTargetMode,
  onPickSimNode,
}: NetworkCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 24, y: 24 });
  const [isDragOver, setIsDragOver] = useState(false);

  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [panningStart, setPanningStart] = useState<{
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const [connectStartNodeId, setConnectStartNodeId] = useState<string | null>(
    null
  );
  const [connectCursor, setConnectCursor] = useState<Point | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const fitToView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) {
      setZoom(1);
      setPan({ x: 24, y: 24 });
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
    const maxY = Math.max(
      ...nodes.map((n) => n.y + getNodeHeight(n, resolvedNicsMap))
    );
    const contentW = Math.max(200, maxX - minX);
    const contentH = Math.max(160, maxY - minY);
    const pad = 76;
    const scaleX = (rect.width - pad * 2) / contentW;
    const scaleY = (rect.height - pad * 2) / contentH;
    const nextZoom = Math.min(1.08, Math.max(0.55, Math.min(scaleX, scaleY)));
    const nextPanX = (rect.width - contentW * nextZoom) / 2 - minX * nextZoom;
    const nextPanY = (rect.height - contentH * nextZoom) / 2 - minY * nextZoom;
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) });
  }, [nodes, resolvedNicsMap]);

  const hasAutoFitted = useRef(false);
  useEffect(() => {
    if (!hasAutoFitted.current && nodes.length > 0) {
      hasAutoFitted.current = true;
      const timer = setTimeout(fitToView, 60);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitToView]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectStartNodeId(null);
        setConnectCursor(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const deviceType = (e.dataTransfer.getData('application/x-netflow-device') ||
      e.dataTransfer.getData('text/plain')) as DeviceType;
    if (!deviceType || !DEVICE_CATALOG_MAP[deviceType]) return;

    const world = clientToWorld(e.clientX, e.clientY);
    const snappedX = Math.round((world.x - NODE_WIDTH / 2) / 16) * 16;
    const snappedY = Math.round((world.y - BASE_NODE_HEIGHT / 2) / 16) * 16;
    onDropNewDevice(deviceType, snappedX, snappedY);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.target !== e.currentTarget &&
      (e.target as HTMLElement).dataset.canvasBg !== 'true'
    ) {
      return;
    }
    setConnectStartNodeId(null);
    setConnectCursor(null);
    onSelectNode(null);
    onSelectEdge(null);

    setPanningStart({
      pointerX: e.clientX,
      pointerY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingNode) {
      const world = clientToWorld(e.clientX, e.clientY);
      const nextX = Math.round((world.x - draggingNode.offsetX) / 16) * 16;
      const nextY = Math.round((world.y - draggingNode.offsetY) / 16) * 16;
      onMoveNode(draggingNode.id, nextX, nextY);
      return;
    }

    if (panningStart) {
      const dx = e.clientX - panningStart.pointerX;
      const dy = e.clientY - panningStart.pointerY;
      setPan({
        x: panningStart.panX + dx,
        y: panningStart.panY + dy,
      });
      return;
    }

    if (connectStartNodeId) {
      setConnectCursor(clientToWorld(e.clientX, e.clientY));
    }
  };

  const handleCanvasPointerUp = () => {
    if (draggingNode) {
      setDraggingNode(null);
      onMoveNodeEnd();
    }
    if (panningStart) {
      setPanningStart(null);
    }
    if (
      connectStartNodeId &&
      hoveredNodeId &&
      hoveredNodeId !== connectStartNodeId
    ) {
      onConnectNodes(connectStartNodeId, hoveredNodeId);
      setConnectStartNodeId(null);
      setConnectCursor(null);
    } else if (connectStartNodeId && interactionMode === 'select') {
      setConnectStartNodeId(null);
      setConnectCursor(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((prev) =>
        Number(Math.min(1.6, Math.max(0.45, prev + delta)).toFixed(2))
      );
    }
  };

  const handleNodePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    node: NetworkNode
  ) => {
    e.stopPropagation();

    if (pickTargetMode) {
      onPickSimNode(node.id);
      return;
    }

    if (interactionMode === 'connect') {
      if (!connectStartNodeId) {
        const h = getNodeHeight(node, resolvedNicsMap);
        setConnectStartNodeId(node.id);
        setConnectCursor({
          x: node.x + NODE_WIDTH / 2,
          y: node.y + h / 2,
        });
      } else if (connectStartNodeId !== node.id) {
        onConnectNodes(connectStartNodeId, node.id);
        setConnectStartNodeId(null);
        setConnectCursor(null);
      } else {
        setConnectStartNodeId(null);
        setConnectCursor(null);
      }
      return;
    }

    onSelectNode(node.id);
    const world = clientToWorld(e.clientX, e.clientY);
    setDraggingNode({
      id: node.id,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y,
    });
  };

  const handlePortPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    node: NetworkNode
  ) => {
    e.stopPropagation();
    setConnectStartNodeId(node.id);
    setConnectCursor(clientToWorld(e.clientX, e.clientY));
  };

  const activeRouteEdgeIds = useMemo(() => {
    if (!showSimulationOverlay || !computedFlow) return new Set<string>();
    return new Set(computedFlow.outboundEdgeIds);
  }, [showSimulationOverlay, computedFlow]);

  const currentHop =
    showSimulationOverlay && computedFlow && computedFlow.hops.length > 0
      ? computedFlow.hops[
          Math.min(activeStepIndex, computedFlow.hops.length - 1)
        ]
      : null;

  const animatedPacketPos = useMemo(() => {
    if (
      !showSimulationOverlay ||
      !computedFlow ||
      computedFlow.hops.length === 0
    ) {
      return null;
    }

    const clampedIdx = Math.min(activeStepIndex, computedFlow.hops.length - 1);
    const toHop = computedFlow.hops[clampedIdx];
    const toNode = nodeMap.get(toHop.nodeId);
    if (!toNode) return null;
    const toH = getNodeHeight(toNode, resolvedNicsMap);

    if (clampedIdx === 0 || !isSimulating) {
      return {
        x: toNode.x + NODE_WIDTH / 2,
        y: toNode.y + toH / 2,
        color:
          toHop.status === 'blocked' ? '#DC2626' : computedFlow.scenario.color,
        label:
          toHop.status === 'blocked'
            ? 'BỊ CHẶN'
            : toHop.direction === 'inbound'
            ? 'PHẢN HỒI'
            : computedFlow.scenario.protocol,
        isBlocked: toHop.status === 'blocked',
      };
    }

    const fromHop = computedFlow.hops[clampedIdx - 1];
    const fromNode = nodeMap.get(fromHop.nodeId);
    if (!fromNode) return null;
    const fromH = getNodeHeight(fromNode, resolvedNicsMap);

    const path = getEdgePathData(fromNode, toNode, fromH, toH);
    const pt = evalCubicBezier(
      { x: path.sx, y: path.sy },
      { x: path.cx1, y: path.cy1 },
      { x: path.cx2, y: path.cy2 },
      { x: path.tx, y: path.ty },
      Math.max(0, Math.min(1, segmentProgress))
    );

    const isBlockedNow = toHop.status === 'blocked' && segmentProgress >= 0.85;
    return {
      x: pt.x,
      y: pt.y,
      color: isBlockedNow ? '#DC2626' : computedFlow.scenario.color,
      label: isBlockedNow
        ? 'BỊ CHẶN'
        : toHop.direction === 'inbound'
        ? 'PHẢN HỒI'
        : computedFlow.scenario.protocol,
      isBlocked: isBlockedNow,
    };
  }, [
    showSimulationOverlay,
    computedFlow,
    activeStepIndex,
    segmentProgress,
    isSimulating,
    nodeMap,
    resolvedNicsMap,
  ]);

  const connectStartNode = connectStartNodeId
    ? nodeMap.get(connectStartNodeId)
    : null;
  const connectStartH = connectStartNode
    ? getNodeHeight(connectStartNode, resolvedNicsMap)
    : BASE_NODE_HEIGHT;

  return (
    <div
      ref={containerRef}
      data-canvas-bg="true"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onWheel={handleWheel}
      className={`flex-1 min-w-0 h-full relative overflow-hidden blueprint-dots select-none ${
        isDragOver ? 'ring-2 ring-inset ring-sky-500 bg-sky-50/40' : ''
      } ${
        pickTargetMode
          ? 'cursor-crosshair'
          : interactionMode === 'connect'
          ? 'cursor-crosshair'
          : panningStart
          ? 'cursor-grabbing'
          : 'cursor-default'
      }`}
    >
      {/* Top-left floating workspace toolbar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 flex-wrap pointer-events-auto">
        <div className="flex items-center p-1 bg-white border border-slate-200 rounded-lg shadow-xs">
          <button
            type="button"
            onClick={() => {
              setInteractionMode('select');
              setConnectStartNodeId(null);
              setConnectCursor(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              interactionMode === 'select'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <MousePointer2 className="w-3.5 h-3.5" />
            <span>Di chuyển</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setInteractionMode('connect');
              setConnectStartNodeId(null);
              setConnectCursor(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              interactionMode === 'connect'
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            <span>Nối dây</span>
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg shadow-xs">
          <button
            type="button"
            onClick={onAutoLayout}
            title="Tự động sắp xếp gọn gàng"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Sắp xếp gọn</span>
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Hoàn tác (Ctrl+Z)"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Hoàn tác</span>
          </button>
          <button
            type="button"
            onClick={onClearCanvas}
            disabled={nodes.length === 0}
            title="Xóa toàn bộ bảng vẽ"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa hết</span>
          </button>
        </div>
      </div>

      {/* Contextual instruction banner */}
      {(pickTargetMode || interactionMode === 'connect') && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-sm pointer-events-none whitespace-nowrap">
          {pickTargetMode === 'source'
            ? 'Nhấn vào một thiết bị trên sơ đồ để chọn làm Thiết bị gửi'
            : pickTargetMode === 'target'
            ? 'Nhấn vào một thiết bị trên sơ đồ để chọn làm Thiết bị nhận'
            : connectStartNodeId
            ? 'Nhấn vào thiết bị thứ hai để hoàn tất đường dây nối (Nhấn Esc để hủy)'
            : 'Chế độ Nối dây: Nhấn thiết bị thứ nhất rồi nhấn thiết bị thứ hai (PC tự thêm card mạng mới khi nối nhiều mạng)'}
        </div>
      )}

      {/* Bottom-left Zoom & Fit controls */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg shadow-xs pointer-events-auto">
        <button
          type="button"
          onClick={() =>
            setZoom((z) => Number(Math.max(0.45, z - 0.1).toFixed(2)))
          }
          aria-label="Thu nhỏ"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="px-2 text-xs font-mono tabular-nums text-slate-700 min-w-[48px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() =>
            setZoom((z) => Number(Math.min(1.6, z + 0.1).toFixed(2)))
          }
          aria-label="Phóng to"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-slate-200 mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          title="Căn vừa màn hình"
          aria-label="Căn vừa màn hình"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom-right legend */}
      <div className="absolute bottom-4 right-4 z-20 hidden sm:flex items-center gap-3 px-3 py-1.5 bg-white/90 backdrop-blur-xs border border-slate-200 rounded-lg text-[11px] text-slate-600 pointer-events-none">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-[#0284C7] inline-block" />
          Cáp quang
        </span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-[#475569] inline-block" />
          Cáp LAN
        </span>
        <span className="text-slate-300" aria-hidden="true">
          ·
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-[#D97706] inline-block" />
          Wi-Fi
        </span>
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none px-6">
          <div className="max-w-md text-center bg-white border border-slate-200 rounded-xl p-6 shadow-xs pointer-events-auto">
            <h3 className="text-base font-semibold text-slate-900">
              Bảng vẽ sơ đồ mạng đang trống
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              {aiEnabled
                ? 'Kéo thiết bị từ cột bên trái thả vào đây, mở một sơ đồ mẫu có sẵn hoặc mô tả bằng tiếng Việt để trợ lý AI tự động vẽ giúp bạn.'
                : 'Kéo thiết bị từ cột bên trái thả vào đây hoặc chọn nhanh một sơ đồ mẫu có sẵn để bắt đầu.'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2.5">
              {aiEnabled && onFocusAi && (
                <button
                  type="button"
                  onClick={onFocusAi}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Nhờ AI vẽ sơ đồ</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenTemplates}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  aiEnabled
                    ? 'text-slate-700 bg-white border border-slate-200 hover:bg-slate-50'
                    : 'text-white bg-sky-600 hover:bg-sky-700'
                }`}
              >
                Chọn mẫu có sẵn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* World Transform Layer */}
      <div
        data-canvas-bg="true"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* SVG Layer for Connections & Animated Packets */}
        <svg
          className="overflow-visible absolute top-0 left-0 w-1 h-1 pointer-events-none"
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const path = getEdgePathData(
              source,
              target,
              getNodeHeight(source, resolvedNicsMap),
              getNodeHeight(target, resolvedNicsMap)
            );
            const meta = CONNECTION_META[edge.type];
            const isSelected = selectedEdgeId === edge.id;
            const isRouteActive = activeRouteEdgeIds.has(edge.id);
            const isBroken = edge.status === 'down';

            const strokeColor = isBroken
              ? '#DC2626'
              : isSelected
              ? '#0284C7'
              : isRouteActive && computedFlow
              ? computedFlow.scenario.color
              : meta.stroke;

            return (
              <g key={edge.id} className="pointer-events-auto cursor-pointer">
                <path
                  d={path.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                />

                {isRouteActive && !isBroken && (
                  <path
                    d={path.d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={8}
                    strokeOpacity={0.18}
                    strokeLinecap="round"
                  />
                )}

                <path
                  d={path.d}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isSelected || isRouteActive ? 3 : 2.2}
                  strokeDasharray={
                    isBroken ? '5 5' : meta.dashArray ? meta.dashArray : undefined
                  }
                  strokeLinecap="round"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                />

                {(isSelected || isBroken || isRouteActive) && (
                  <g
                    transform={`translate(${path.midX}, ${path.midY})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEdge(edge.id);
                    }}
                  >
                    <rect
                      x={-52}
                      y={-11}
                      width={104}
                      height={22}
                      rx={6}
                      fill="#FFFFFF"
                      stroke={isBroken ? '#FCA5A5' : '#CBD5E1'}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill={isBroken ? '#DC2626' : '#334155'}
                    >
                      {isBroken
                        ? 'Đứt kết nối'
                        : `${meta.shortLabel} · ${edge.bandwidth}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {connectStartNode && connectCursor && (
            <path
              d={`M ${connectStartNode.x + NODE_WIDTH / 2} ${
                connectStartNode.y + connectStartH / 2
              } L ${connectCursor.x} ${connectCursor.y}`}
              fill="none"
              stroke="#0284C7"
              strokeWidth={2.5}
              strokeDasharray="6 4"
            />
          )}

          {animatedPacketPos && (
            <g
              transform={`translate(${animatedPacketPos.x}, ${animatedPacketPos.y})`}
              className="pointer-events-none"
            >
              <circle
                r={15}
                fill={animatedPacketPos.color}
                fillOpacity={0.22}
              />
              <circle
                r={7.5}
                fill={animatedPacketPos.color}
                stroke="#FFFFFF"
                strokeWidth={2.5}
              />
              <g transform="translate(0, -22)">
                <rect
                  x={-36}
                  y={-11}
                  width={72}
                  height={20}
                  rx={6}
                  fill={animatedPacketPos.color}
                />
                <text
                  x={0}
                  y={2.5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={700}
                  fill="#FFFFFF"
                  fontFamily="var(--font-mono), monospace"
                >
                  {animatedPacketPos.label}
                </text>
              </g>
            </g>
          )}
        </svg>

        {/* HTML Node Cards Layer */}
        {nodes.map((node) => {
          const catalog = DEVICE_CATALOG_MAP[node.type];
          const resolvedNics = resolvedNicsMap.get(node.id);
          const connectedNics = resolvedNics?.filter((r) => r.connected) ?? [];
          const nodeHeight = getNodeHeight(node, resolvedNicsMap);

          const isSelected = selectedNodeId === node.id;
          const isConnectSource = connectStartNodeId === node.id;
          const isSimSource =
            showSimulationOverlay && simSourceId === node.id;
          const isSimTarget =
            showSimulationOverlay && simTargetId === node.id;
          const isCurrentHop =
            showSimulationOverlay && currentHop?.nodeId === node.id;
          const isBlockedHere =
            showSimulationOverlay &&
            computedFlow?.blockedAtNodeId === node.id &&
            currentHop?.status === 'blocked';
          const isOffline = node.status === 'offline';

          return (
            <div
              key={node.id}
              style={{
                transform: `translate(${node.x}px, ${node.y}px)`,
                width: NODE_WIDTH,
                minHeight: nodeHeight,
              }}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              onPointerEnter={() => setHoveredNodeId(node.id)}
              onPointerLeave={() =>
                setHoveredNodeId((prev) => (prev === node.id ? null : prev))
              }
              className={`absolute top-0 left-0 pointer-events-auto group rounded-xl bg-white border transition-shadow duration-150 ${
                isBlockedHere
                  ? 'border-red-600 ring-4 ring-red-100 shadow-sm'
                  : isCurrentHop
                  ? 'border-sky-600 ring-4 ring-sky-100 shadow-sm'
                  : isConnectSource
                  ? 'border-sky-600 ring-2 ring-sky-200'
                  : isSelected
                  ? 'border-slate-900 ring-2 ring-slate-900/10 shadow-sm'
                  : 'border-slate-200 hover:border-slate-400 shadow-2xs'
              } ${isOffline ? 'opacity-65 bg-slate-50' : ''} ${
                interactionMode === 'select' && !pickTargetMode
                  ? 'cursor-grab active:cursor-grabbing'
                  : 'cursor-pointer'
              }`}
            >
              {/* Simulation Endpoint or Blocked Callout */}
              {(isSimSource || isSimTarget || isBlockedHere) && (
                <div className="absolute -top-6 left-0 right-0 flex justify-center pointer-events-none">
                  {isBlockedHere ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold">
                      <ShieldAlert className="w-3 h-3" />
                      Đã chặn truy cập lạ
                    </span>
                  ) : isSimSource ? (
                    <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-semibold">
                      Thiết bị gửi
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-sky-700 text-white text-[10px] font-semibold">
                      Thiết bị nhận
                    </span>
                  )}
                </div>
              )}

              {/* Card Body */}
              <div className="px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border"
                    style={{
                      backgroundColor: isOffline ? '#F1F5F9' : catalog.bgTint,
                      borderColor: isOffline ? '#CBD5E1' : catalog.borderTint,
                      color: isOffline ? '#64748B' : catalog.accentColor,
                    }}
                  >
                    <DeviceIcon type={node.type} className="w-4.5 h-4.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 truncate leading-snug">
                      {node.label}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {isOffline
                        ? 'Đang tắt nguồn'
                        : resolvedNics && resolvedNics.length > 1
                        ? `${catalog.shortName} · ${resolvedNics.length} card`
                        : catalog.shortName}
                    </div>
                  </div>
                </div>

                {/* IP Address Display: Show ALL connected NIC IPs if multi-NIC capable */}
                {resolvedNics && resolvedNics.length > 0 ? (
                  <div className="pt-1 border-t border-slate-100 space-y-0.5">
                    {connectedNics.length === 0 ? (
                      <div className="text-[10.5px] font-mono text-slate-400 truncate">
                        {isOffline ? 'Tắt nguồn · Không có IP' : 'Chưa kết nối mạng'}
                      </div>
                    ) : (
                      connectedNics.map((nic, idx) => (
                        <div
                          key={nic.nicId}
                          className="flex items-center justify-between gap-1 text-[10.5px] font-mono tabular-nums leading-tight"
                        >
                          <span
                            className={`truncate ${
                              nic.effectiveIp
                                ? 'text-slate-700 font-medium'
                                : 'text-amber-700'
                            }`}
                          >
                            {connectedNics.length > 1 ? `#${idx + 1} ` : ''}
                            {nic.effectiveIp ?? 'Chưa có DHCP'}
                          </span>
                          <span
                            className={`text-[9.5px] font-sans shrink-0 ${
                              nic.ipMode === 'dhcp'
                                ? 'text-sky-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {nic.ipMode === 'dhcp' ? 'DHCP' : 'Tĩnh'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-1 text-[10.5px] font-mono tabular-nums text-slate-600">
                    <span className="truncate">{node.ip}</span>
                    {catalog.supportsDhcpServer &&
                      (node.dhcpPool?.enabled ?? true) && (
                        <span className="text-[9.5px] font-sans text-teal-700 shrink-0">
                          Cấp DHCP
                        </span>
                      )}
                  </div>
                )}
              </div>

              {/* 4 Connection Port Handles */}
              {!pickTargetMode && (
                <>
                  <button
                    type="button"
                    aria-label={`Kéo nối dây từ cạnh phải ${node.label}`}
                    onPointerDown={(e) => handlePortPointerDown(e, node)}
                    className={`absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-sky-600 hover:bg-sky-600 transition-opacity ${
                      isSelected ||
                      hoveredNodeId === node.id ||
                      connectStartNodeId
                        ? 'opacity-100'
                        : 'opacity-0'
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={`Kéo nối dây từ cạnh trái ${node.label}`}
                    onPointerDown={(e) => handlePortPointerDown(e, node)}
                    className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-sky-600 hover:bg-sky-600 transition-opacity ${
                      isSelected ||
                      hoveredNodeId === node.id ||
                      connectStartNodeId
                        ? 'opacity-100'
                        : 'opacity-0'
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={`Kéo nối dây từ cạnh trên ${node.label}`}
                    onPointerDown={(e) => handlePortPointerDown(e, node)}
                    className={`absolute left-1/2 -top-2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-sky-600 hover:bg-sky-600 transition-opacity ${
                      isSelected ||
                      hoveredNodeId === node.id ||
                      connectStartNodeId
                        ? 'opacity-100'
                        : 'opacity-0'
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={`Kéo nối dây từ cạnh dưới ${node.label}`}
                    onPointerDown={(e) => handlePortPointerDown(e, node)}
                    className={`absolute left-1/2 -bottom-2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-sky-600 hover:bg-sky-600 transition-opacity ${
                      isSelected ||
                      hoveredNodeId === node.id ||
                      connectStartNodeId
                        ? 'opacity-100'
                        : 'opacity-0'
                    }`}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
