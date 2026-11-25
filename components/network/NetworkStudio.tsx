'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Pause, Play, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  CONNECTION_META,
  DEVICE_CATALOG_MAP,
  NETWORK_TEMPLATES,
  inferConnectionType,
} from '@/lib/network/catalog';
import {
  autoLayoutNodes,
  computePacketFlow,
  exportDiagramToSvg,
  generateNextIp,
  getDefaultDhcpPool,
  getEffectiveNodeNics,
  resolveAllNodeNics,
} from '@/lib/network/simulation';
import {
  ParsedDiagramResult,
  renderSvgToPngBlob,
  serializeDiagramToJson,
  slugifyFilename,
} from '@/lib/network/io';
import {
  AiGeneratedDiagram,
  DeviceType,
  NetworkEdge,
  NetworkInterface,
  NetworkNode,
  NetworkTemplate,
  PacketScenarioId,
} from '@/lib/network/types';
import { AiAssistantPanel } from './AiAssistantPanel';
import { DevicePalette } from './DevicePalette';
import { ImportExportModal } from './ImportExportModal';
import { InspectorPanel } from './InspectorPanel';
import { NetworkCanvas } from './NetworkCanvas';
import { PacketFlowPanel } from './PacketFlowPanel';
import { TemplatesModal } from './TemplatesModal';

type RightTab = 'flow' | 'ai' | 'inspector';

interface Snapshot {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

const STORAGE_KEY = 'netflow_studio_diagram_v1';
const DEFAULT_TEMPLATE = NETWORK_TEMPLATES[0];

interface NetworkStudioProps {
  aiEnabled?: boolean;
}

export function NetworkStudio({ aiEnabled = false }: NetworkStudioProps) {
  const [diagramTitle, setDiagramTitle] = useState(DEFAULT_TEMPLATE.name);
  const [nodes, setNodes] = useState<NetworkNode[]>(DEFAULT_TEMPLATE.nodes);
  const [edges, setEdges] = useState<NetworkEdge[]>(DEFAULT_TEMPLATE.edges);
  const [history, setHistory] = useState<Snapshot[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'select' | 'connect'>(
    'select'
  );

  const [rightTab, setRightTab] = useState<RightTab>('flow');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Packet flow simulation state
  const [simSourceId, setSimSourceId] = useState<string>(
    DEFAULT_TEMPLATE.defaultSimulation.sourceId
  );
  const [simTargetId, setSimTargetId] = useState<string>(
    DEFAULT_TEMPLATE.defaultSimulation.targetId
  );
  const [scenarioId, setScenarioId] = useState<PacketScenarioId>(
    DEFAULT_TEMPLATE.defaultSimulation.scenarioId
  );
  const [pickTargetMode, setPickTargetMode] = useState<
    'source' | 'target' | null
  >(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [segmentProgress, setSegmentProgress] = useState(1);
  const [speed, setSpeed] = useState(1.0);

  // Hydrate saved state from localStorage asynchronously after mount
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (Array.isArray(saved?.nodes) && Array.isArray(saved?.edges)) {
          setNodes(saved.nodes);
          setEdges(saved.edges);
          if (typeof saved.title === 'string') setDiagramTitle(saved.title);
          if (
            typeof saved.simSourceId === 'string' &&
            saved.nodes.some((n: NetworkNode) => n.id === saved.simSourceId)
          ) {
            setSimSourceId(saved.simSourceId);
          }
          if (
            typeof saved.simTargetId === 'string' &&
            saved.nodes.some((n: NetworkNode) => n.id === saved.simTargetId)
          ) {
            setSimTargetId(saved.simTargetId);
          }
        }
      } catch {
        // Ignore malformed localStorage
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Persist changes to localStorage
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          title: diagramTitle,
          nodes,
          edges,
          simSourceId,
          simTargetId,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [diagramTitle, nodes, edges, simSourceId, simTargetId]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2800);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-24), { nodes, edges }]);
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setNodes(last.nodes);
      setEdges(last.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return prev.slice(0, -1);
    });
  }, []);

  // Resolve all multi-NIC IP addresses & live DHCP leases across the entire diagram
  const resolvedNicsMap = useMemo(
    () => resolveAllNodeNics(nodes, edges),
    [nodes, edges]
  );

  // Compute live packet flow from current graph
  const computedFlow = useMemo(() => {
    if (!simSourceId || !simTargetId) return null;
    return computePacketFlow(
      nodes,
      edges,
      simSourceId,
      simTargetId,
      scenarioId,
      resolvedNicsMap
    );
  }, [nodes, edges, simSourceId, simTargetId, scenarioId, resolvedNicsMap]);

  const totalHops = computedFlow?.hops.length ?? 0;
  const effectiveIsSimulating = isSimulating && totalHops > 1;
  const safeStepIndex =
    totalHops > 0 ? Math.min(activeStepIndex, totalHops - 1) : 0;

  // Smooth 60fps requestAnimationFrame loop for animated packet movement
  useEffect(() => {
    if (!effectiveIsSimulating) return;

    let rafId = 0;
    let lastTime = performance.now();
    let step = safeStepIndex <= 0 ? 1 : safeStepIndex;
    let progress =
      step === safeStepIndex && segmentProgress < 1 ? segmentProgress : 0;
    let dwellMs = 0;
    let initialized = false;

    const stepDurationMs = 1150 / speed;
    const endDwellMs = 900 / speed;

    const tick = (now: number) => {
      const dt = Math.min(64, now - lastTime);
      lastTime = now;

      if (!initialized) {
        initialized = true;
        setActiveStepIndex(step);
        setSegmentProgress(progress);
      }

      if (dwellMs > 0) {
        dwellMs -= dt;
        if (dwellMs <= 0) {
          step = 1;
          progress = 0;
          setActiveStepIndex(1);
          setSegmentProgress(0);
        }
        rafId = requestAnimationFrame(tick);
        return;
      }

      progress += dt / stepDurationMs;
      if (progress >= 1) {
        if (step < totalHops - 1) {
          step += 1;
          progress = 0;
          setActiveStepIndex(step);
          setSegmentProgress(0);
        } else {
          setSegmentProgress(1);
          dwellMs = endDwellMs;
        }
      } else {
        setSegmentProgress(progress);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // Intentionally drive loop from simulation toggle, speed, and total hop count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsSimulating, speed, totalHops]);

  // Add device via drop or click
  const addDeviceAt = useCallback(
    (type: DeviceType, x?: number, y?: number) => {
      pushHistory();
      const catalog = DEVICE_CATALOG_MAP[type];
      const existingCount = nodes.filter((n) => n.type === type).length;
      const newId = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const fallbackX = 240 + ((nodes.length * 48) % 480);
      const fallbackY = 160 + ((nodes.length * 40) % 260);
      const initialIp = generateNextIp(type, nodes);
      const defaultPrefix = initialIp.split('.').slice(0, 3).join('.') || '192.168.1';

      const initialNics: NetworkInterface[] | undefined = catalog.supportsMultiNic
        ? [
            {
              id: `${newId}-nic-1`,
              name: 'Card mạng 1',
              ipMode:
                type === 'server' || type === 'nas' || type === 'printer'
                  ? 'static'
                  : 'dhcp',
              staticIp: initialIp,
              subnetMask: '255.255.255.0',
              gateway: `${defaultPrefix}.1`,
            },
          ]
        : undefined;

      const baseNode: NetworkNode = {
        id: newId,
        type,
        label:
          existingCount > 0
            ? `${catalog.shortName} ${existingCount + 1}`
            : catalog.shortName,
        ip: initialIp,
        x: x ?? Math.round(fallbackX / 16) * 16,
        y: y ?? Math.round(fallbackY / 16) * 16,
        status: 'active',
        blockThreats: type === 'firewall' ? true : undefined,
        nics: initialNics,
      };

      const nextNode: NetworkNode = catalog.supportsDhcpServer
        ? { ...baseNode, dhcpPool: getDefaultDhcpPool(baseNode) }
        : baseNode;

      setNodes((prev) => [...prev, nextNode]);
      setSelectedNodeId(newId);
      setSelectedEdgeId(null);
      showToast(`Đã thêm ${nextNode.label}`);
    },
    [nodes, pushHistory, showToast]
  );

  // Move node smoothly (push history once at drag end via ref flag)
  const dragSnapshotTakenRef = useRef(false);
  const handleMoveNode = useCallback(
    (id: string, x: number, y: number) => {
      if (!dragSnapshotTakenRef.current) {
        dragSnapshotTakenRef.current = true;
        pushHistory();
      }
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x, y } : n))
      );
    },
    [pushHistory]
  );

  const handleMoveNodeEnd = useCallback(() => {
    dragSnapshotTakenRef.current = false;
  }, []);

  // Connect two nodes (auto-binds or auto-creates a new NIC on multi-NIC devices!)
  const handleConnectNodes = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const exists = edges.some(
        (e) =>
          (e.source === sourceId && e.target === targetId) ||
          (e.source === targetId && e.target === sourceId)
      );
      if (exists) {
        showToast('Hai thiết bị này đã được kết nối với nhau rồi.');
        return;
      }

      const sourceNode = nodes.find((n) => n.id === sourceId);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) return;

      pushHistory();

      const allocateNicForNode = (
        node: NetworkNode
      ): { nicId?: string; updatedNics?: NetworkInterface[]; addedNew: boolean } => {
        if (!DEVICE_CATALOG_MAP[node.type]?.supportsMultiNic) {
          return { addedNew: false };
        }
        const currentNics = getEffectiveNodeNics(node, edges);
        const usedNicIds = new Set<string>();
        const attachedEdges = edges.filter(
          (e) => e.source === node.id || e.target === node.id
        );
        attachedEdges.forEach((e) => {
          const explicit = e.source === node.id ? e.sourceNicId : e.targetNicId;
          if (explicit) usedNicIds.add(explicit);
        });
        // Account for legacy unbound edges
        let unboundCount = attachedEdges.filter((e) =>
          e.source === node.id ? !e.sourceNicId : !e.targetNicId
        ).length;
        for (const nic of currentNics) {
          if (unboundCount <= 0) break;
          if (!usedNicIds.has(nic.id)) {
            usedNicIds.add(nic.id);
            unboundCount -= 1;
          }
        }

        const freeNic = currentNics.find((nic) => !usedNicIds.has(nic.id));
        if (freeNic) {
          return {
            nicId: freeNic.id,
            updatedNics: node.nics ? undefined : currentNics,
            addedNew: false,
          };
        }

        const nextIdx = currentNics.length + 1;
        const newNic: NetworkInterface = {
          id: `${node.id}-nic-${Date.now()}-${nextIdx}`,
          name: `Card mạng ${nextIdx}`,
          ipMode: 'dhcp',
          staticIp: `192.168.${nextIdx}.20`,
          subnetMask: '255.255.255.0',
          gateway: `192.168.${nextIdx}.1`,
        };
        return {
          nicId: newNic.id,
          updatedNics: [...currentNics, newNic],
          addedNew: true,
        };
      };

      const sourceAlloc = allocateNicForNode(sourceNode);
      const targetAlloc = allocateNicForNode(targetNode);

      if (sourceAlloc.updatedNics || targetAlloc.updatedNics) {
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id === sourceNode.id && sourceAlloc.updatedNics) {
              return { ...n, nics: sourceAlloc.updatedNics };
            }
            if (n.id === targetNode.id && targetAlloc.updatedNics) {
              return { ...n, nics: targetAlloc.updatedNics };
            }
            return n;
          })
        );
      }

      const inferredType = inferConnectionType(sourceNode.type, targetNode.type);
      const newEdge: NetworkEdge = {
        id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        source: sourceId,
        target: targetId,
        sourceNicId: sourceAlloc.nicId,
        targetNicId: targetAlloc.nicId,
        type: inferredType,
        bandwidth: CONNECTION_META[inferredType].defaultBandwidth,
        status: 'active',
      };
      setEdges((prev) => [...prev, newEdge]);
      setSelectedEdgeId(newEdge.id);
      setSelectedNodeId(null);

      if (sourceAlloc.addedNew || targetAlloc.addedNew) {
        const addedOwner = sourceAlloc.addedNew
          ? sourceNode.label
          : targetNode.label;
        showToast(
          `Đã tự thêm card mạng mới trên ${addedOwner} và nối ${sourceNode.label} ↔ ${targetNode.label}`
        );
      } else {
        showToast(
          `Đã nối ${sourceNode.label} ↔ ${targetNode.label} (${CONNECTION_META[inferredType].shortLabel})`
        );
      }
    },
    [edges, nodes, pushHistory, showToast]
  );

  const handleUpdateNode = useCallback(
    (id: string, patch: Partial<NetworkNode>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...patch } : n))
      );
    },
    []
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      pushHistory();
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
      if (selectedNodeId === id) setSelectedNodeId(null);
      if (simSourceId === id) setSimSourceId('');
      if (simTargetId === id) setSimTargetId('');
    },
    [pushHistory, selectedNodeId, simSourceId, simTargetId]
  );

  const handleUpdateEdge = useCallback(
    (id: string, patch: Partial<NetworkEdge>) => {
      setEdges((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
      );
    },
    []
  );

  const handleDeleteEdge = useCallback(
    (id: string) => {
      pushHistory();
      setEdges((prev) => prev.filter((e) => e.id !== id));
      if (selectedEdgeId === id) setSelectedEdgeId(null);
    },
    [pushHistory, selectedEdgeId]
  );

  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return;
    pushHistory();
    setNodes((prev) => autoLayoutNodes(prev, edges));
    showToast('Đã tự động sắp xếp sơ đồ gọn gàng');
  }, [nodes.length, edges, pushHistory, showToast]);

  const handleClearCanvas = useCallback(() => {
    if (nodes.length === 0) return;
    pushHistory();
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setSimSourceId('');
    setSimTargetId('');
    setIsSimulating(false);
    showToast('Đã xóa toàn bộ bảng vẽ');
  }, [nodes.length, pushHistory, showToast]);

  const handleLoadTemplate = useCallback(
    (tpl: NetworkTemplate) => {
      pushHistory();
      setDiagramTitle(tpl.name);
      setNodes(tpl.nodes);
      setEdges(tpl.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSimSourceId(tpl.defaultSimulation.sourceId);
      setSimTargetId(tpl.defaultSimulation.targetId);
      setScenarioId(tpl.defaultSimulation.scenarioId);
      setActiveStepIndex(0);
      setSegmentProgress(1);
      setIsSimulating(false);
      showToast(`Đã tải mẫu "${tpl.name}"`);
    },
    [pushHistory, showToast]
  );

  const handleApplyAiDiagram = useCallback(
    (diagram: AiGeneratedDiagram) => {
      pushHistory();
      setDiagramTitle(diagram.title);
      setNodes(diagram.nodes);
      setEdges(diagram.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setIsSimulating(false);
      setActiveStepIndex(0);
      setSegmentProgress(1);

      if (diagram.suggestedSimulation) {
        setSimSourceId(diagram.suggestedSimulation.sourceId);
        setSimTargetId(diagram.suggestedSimulation.targetId);
        setScenarioId(diagram.suggestedSimulation.scenarioId);
      } else if (diagram.nodes.length >= 2) {
        setSimSourceId(diagram.nodes[diagram.nodes.length - 1].id);
        setSimTargetId(diagram.nodes[0].id);
      }
      showToast(`AI đã vẽ xong: ${diagram.title}`);
    },
    [pushHistory, showToast]
  );

  const handleRunSuggestedSimulation = useCallback(
    (sim: NonNullable<AiGeneratedDiagram['suggestedSimulation']>) => {
      setSimSourceId(sim.sourceId);
      setSimTargetId(sim.targetId);
      setScenarioId(sim.scenarioId);
      setRightTab('flow');
      setActiveStepIndex(0);
      setSegmentProgress(0);
      setIsSimulating(true);
    },
    []
  );

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportJson = useCallback(() => {
    const jsonText = serializeDiagramToJson({
      title: diagramTitle,
      nodes,
      edges,
      simSourceId,
      simTargetId,
      scenarioId,
    });
    const blob = new Blob([jsonText], {
      type: 'application/json;charset=utf-8',
    });
    downloadBlob(blob, `${slugifyFilename(diagramTitle)}.json`);
    showToast('Đã xuất tệp sơ đồ mạng (.json)');
  }, [
    diagramTitle,
    nodes,
    edges,
    simSourceId,
    simTargetId,
    scenarioId,
    downloadBlob,
    showToast,
  ]);

  const handleExportSvg = useCallback(() => {
    const svgText = exportDiagramToSvg(nodes, edges, diagramTitle);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${slugifyFilename(diagramTitle)}.svg`);
    showToast('Đã tải xuống ảnh sơ đồ định dạng SVG');
  }, [nodes, edges, diagramTitle, downloadBlob, showToast]);

  const handleExportPng = useCallback(async () => {
    try {
      const svgText = exportDiagramToSvg(nodes, edges, diagramTitle);
      const pngBlob = await renderSvgToPngBlob(svgText);
      downloadBlob(pngBlob, `${slugifyFilename(diagramTitle)}.png`);
      showToast('Đã tải xuống ảnh sơ đồ định dạng PNG');
    } catch {
      showToast('Không thể xuất ảnh PNG trên trình duyệt này. Vui lòng thử SVG.');
    }
  }, [nodes, edges, diagramTitle, downloadBlob, showToast]);

  const handleCopyJson = useCallback(async (): Promise<boolean> => {
    const jsonText = serializeDiagramToJson({
      title: diagramTitle,
      nodes,
      edges,
      simSourceId,
      simTargetId,
      scenarioId,
    });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(jsonText);
        showToast('Đã sao chép mã JSON sơ đồ vào bộ nhớ tạm');
        return true;
      }
      return false;
    } catch {
      showToast('Không thể truy cập bộ nhớ tạm để sao chép JSON');
      return false;
    }
  }, [diagramTitle, nodes, edges, simSourceId, simTargetId, scenarioId, showToast]);

  const handleImportDiagram = useCallback(
    (data: ParsedDiagramResult) => {
      pushHistory();
      setDiagramTitle(data.title);
      setNodes(data.nodes);
      setEdges(data.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setIsSimulating(false);
      setActiveStepIndex(0);
      setSegmentProgress(1);

      if (data.simulation) {
        setSimSourceId(data.simulation.sourceId);
        setSimTargetId(data.simulation.targetId);
        setScenarioId(data.simulation.scenarioId);
      } else if (data.nodes.length >= 2) {
        const endpoint =
          data.nodes.find((n) => ['laptop', 'pc', 'phone'].includes(n.type)) ??
          data.nodes[data.nodes.length - 1];
        const dest =
          data.nodes.find(
            (n) =>
              n.id !== endpoint.id &&
              ['internet', 'server', 'dns', 'printer'].includes(n.type)
          ) ?? data.nodes.find((n) => n.id !== endpoint.id)!;
        setSimSourceId(endpoint.id);
        setSimTargetId(dest.id);
        setScenarioId('web_https');
      } else {
        setSimSourceId('');
        setSimTargetId('');
      }

      showToast(
        `Đã nhập sơ đồ "${data.title}" (${data.nodes.length} thiết bị, ${data.edges.length} kết nối)`
      );
    },
    [pushHistory, showToast]
  );

  // Global keyboard shortcuts (Undo, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditingText) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          e.preventDefault();
          handleDeleteEdge(selectedEdgeId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, selectedNodeId, selectedEdgeId, handleDeleteNode, handleDeleteEdge]);

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    if (id) setRightTab('inspector');
  }, []);

  const handleSelectEdge = useCallback((id: string | null) => {
    setSelectedEdgeId(id);
    setSelectedNodeId(null);
    if (id) setRightTab('inspector');
  }, []);

  const handlePickSimNode = useCallback(
    (nodeId: string) => {
      if (pickTargetMode === 'source') {
        setSimSourceId(nodeId);
      } else if (pickTargetMode === 'target') {
        setSimTargetId(nodeId);
      }
      setPickTargetMode(null);
      setActiveStepIndex(0);
      setSegmentProgress(1);
    },
    [pickTargetMode]
  );

  const handlePrimarySimulateToggle = useCallback(() => {
    setRightTab('flow');
    if (isSimulating) {
      setIsSimulating(false);
      return;
    }

    // Auto-select sensible endpoints if none picked yet
    if ((!simSourceId || !simTargetId) && nodes.length >= 2) {
      const endpoint =
        nodes.find((n) => ['laptop', 'pc', 'phone'].includes(n.type)) ??
        nodes[nodes.length - 1];
      const dest =
        nodes.find((n) => n.id !== endpoint.id && ['internet', 'server', 'printer'].includes(n.type)) ??
        nodes.find((n) => n.id !== endpoint.id)!;
      setSimSourceId(endpoint.id);
      setSimTargetId(dest.id);
    }
    setActiveStepIndex(0);
    setSegmentProgress(0);
    setIsSimulating(true);
  }, [isSimulating, simSourceId, simTargetId, nodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F8FAFC]">
      {/* Top Bar Contract: Strict 3-zone single-row header */}
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 z-30">
        {/* Zone 1: Single text element wordmark */}
        <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          NetFlow Studio
        </span>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Mẫu sơ đồ
          </button>
          {aiEnabled && (
            <button
              type="button"
              onClick={() => setRightTab('ai')}
              className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                rightTab === 'ai' ? 'text-slate-900 font-semibold' : ''
              }`}
            >
              Trợ lý AI
            </button>
          )}
          <button
            type="button"
            onClick={() => setRightTab('flow')}
            className={`hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              rightTab === 'flow' ? 'text-slate-900 font-semibold' : ''
            }`}
          >
            Luồng gói tin
          </button>
          <button
            type="button"
            onClick={() => setImportExportOpen(true)}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Nhập / Xuất
          </button>
        </nav>

        {/* Zone 3: Single primary action button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={handlePrimarySimulateToggle}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              effectiveIsSimulating
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-sky-600 text-white hover:bg-sky-700'
            }`}
          >
            {effectiveIsSimulating ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Dừng mô phỏng</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Mô phỏng luồng</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main 3-Panel Studio Workspace */}
      <main className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Sidebar: Drag & Drop Device Palette */}
        <DevicePalette onAddDeviceClick={(type) => addDeviceAt(type)} />

        {/* Center Stage: Interactive Blueprint Canvas */}
        <NetworkCanvas
          nodes={nodes}
          edges={edges}
          resolvedNicsMap={resolvedNicsMap}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          interactionMode={interactionMode}
          setInteractionMode={setInteractionMode}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onMoveNode={handleMoveNode}
          onMoveNodeEnd={handleMoveNodeEnd}
          onDropNewDevice={(type, x, y) => addDeviceAt(type, x, y)}
          onConnectNodes={handleConnectNodes}
          onAutoLayout={handleAutoLayout}
          onUndo={handleUndo}
          canUndo={history.length > 0}
          onClearCanvas={handleClearCanvas}
          onOpenTemplates={() => setTemplatesOpen(true)}
          aiEnabled={aiEnabled}
          onFocusAi={aiEnabled ? () => setRightTab('ai') : undefined}
          computedFlow={computedFlow}
          isSimulating={effectiveIsSimulating}
          activeStepIndex={safeStepIndex}
          segmentProgress={segmentProgress}
          showSimulationOverlay={rightTab === 'flow' || effectiveIsSimulating}
          simSourceId={simSourceId}
          simTargetId={simTargetId}
          pickTargetMode={pickTargetMode}
          onPickSimNode={handlePickSimNode}
        />

        {/* Right Deck: Packet Flow / AI Architect (optional) / Inspector */}
        <aside className="w-[348px] shrink-0 bg-white border-l border-slate-200 flex flex-col h-full">
          {/* Clean Segmented Tab Switcher */}
          <div className="p-2.5 border-b border-slate-200">
            <div
              role="tablist"
              aria-label="Bảng điều khiển"
              className={`grid gap-1 p-1 bg-slate-100 rounded-lg ${
                aiEnabled ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'flow'}
                onClick={() => setRightTab('flow')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rightTab === 'flow'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span>Gói tin</span>
              </button>
              {aiEnabled && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'ai'}
                  onClick={() => setRightTab('ai')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    rightTab === 'ai'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>AI vẽ</span>
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'inspector'}
                onClick={() => setRightTab('inspector')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  rightTab === 'inspector'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span>Chi tiết</span>
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'flow' && (
              <PacketFlowPanel
                nodes={nodes}
                resolvedNicsMap={resolvedNicsMap}
                sourceId={simSourceId}
                targetId={simTargetId}
                scenarioId={scenarioId}
                onChangeSource={(id) => {
                  setSimSourceId(id);
                  setActiveStepIndex(0);
                  setSegmentProgress(1);
                }}
                onChangeTarget={(id) => {
                  setSimTargetId(id);
                  setActiveStepIndex(0);
                  setSegmentProgress(1);
                }}
                onSwapEndpoints={() => {
                  setSimSourceId(simTargetId);
                  setSimTargetId(simSourceId);
                  setActiveStepIndex(0);
                  setSegmentProgress(1);
                }}
                onChangeScenario={(id) => {
                  setScenarioId(id);
                  setActiveStepIndex(0);
                  setSegmentProgress(1);
                }}
                pickTargetMode={pickTargetMode}
                onSetPickTargetMode={setPickTargetMode}
                computedFlow={computedFlow}
                isSimulating={effectiveIsSimulating}
                onTogglePlay={() => {
                  if (!effectiveIsSimulating && safeStepIndex >= totalHops - 1) {
                    setActiveStepIndex(0);
                    setSegmentProgress(0);
                  }
                  setIsSimulating((prev) => !prev);
                }}
                onStepBack={() => {
                  setIsSimulating(false);
                  setActiveStepIndex((idx) => Math.max(0, Math.min(idx, totalHops - 1) - 1));
                  setSegmentProgress(1);
                }}
                onStepForward={() => {
                  setIsSimulating(false);
                  setActiveStepIndex((idx) => Math.min(totalHops - 1, idx + 1));
                  setSegmentProgress(1);
                }}
                onReset={() => {
                  setIsSimulating(false);
                  setActiveStepIndex(0);
                  setSegmentProgress(1);
                }}
                activeStepIndex={safeStepIndex}
                onJumpToStep={(idx) => {
                  setIsSimulating(false);
                  setActiveStepIndex(idx);
                  setSegmentProgress(1);
                }}
                speed={speed}
                onChangeSpeed={setSpeed}
              />
            )}

            {aiEnabled && rightTab === 'ai' && (
              <AiAssistantPanel
                nodes={nodes}
                edges={edges}
                onApplyAiDiagram={handleApplyAiDiagram}
                onRunSuggestedSimulation={handleRunSuggestedSimulation}
              />
            )}

            {rightTab === 'inspector' && (
              <InspectorPanel
                nodes={nodes}
                edges={edges}
                resolvedNicsMap={resolvedNicsMap}
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                onUpdateNode={handleUpdateNode}
                onDeleteNode={handleDeleteNode}
                onUpdateEdge={handleUpdateEdge}
                onDeleteEdge={handleDeleteEdge}
              />
            )}
          </div>
        </aside>
      </main>

      {/* Starter Templates Modal */}
      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSelectTemplate={handleLoadTemplate}
      />

      {/* Import / Export Diagram Modal */}
      <ImportExportModal
        open={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        diagramTitle={diagramTitle}
        onChangeDiagramTitle={setDiagramTitle}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        onExportJson={handleExportJson}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        onCopyJson={handleCopyJson}
        onImportDiagram={handleImportDiagram}
      />

      {/* Non-intrusive Feedback Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-md pointer-events-none whitespace-nowrap"
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
