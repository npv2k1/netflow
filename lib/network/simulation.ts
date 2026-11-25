import { CONNECTION_META, DEVICE_CATALOG_MAP, PACKET_SCENARIOS } from './catalog';
import {
  ComputedPacketFlow,
  DhcpPoolConfig,
  FlowHop,
  NetworkEdge,
  NetworkInterface,
  NetworkNode,
  PacketScenarioId,
  ResolvedNicState,
} from './types';

// Layer-2 transparent devices that forward DHCP broadcast frames within the same subnet
const LAYER2_BRIDGE_TYPES = new Set(['switch', 'ap']);

export function getDefaultDhcpPool(node: NetworkNode): DhcpPoolConfig {
  if (node.dhcpPool) return node.dhcpPool;
  const parts = node.ip.split('.');
  const prefix =
    parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}` : '192.168.1';
  const gatewayIp =
    node.type === 'router' ? node.ip : `${prefix}.1`;
  return {
    enabled: node.type === 'dhcp' || node.type === 'router',
    networkPrefix: prefix,
    startHost: 100,
    endHost: 200,
    subnetMask: '255.255.255.0',
    gatewayIp,
  };
}

/**
 * Ensures any multi-NIC-capable node has a normalized list of NICs for rendering & resolution.
 * If a legacy/template node doesn't have `nics` yet, derives default NIC(s) cleanly from its edges & ip.
 */
export function getEffectiveNodeNics(
  node: NetworkNode,
  edges: NetworkEdge[]
): NetworkInterface[] {
  const catalog = DEVICE_CATALOG_MAP[node.type];
  if (!catalog?.supportsMultiNic && !node.nics) return [];

  if (node.nics && node.nics.length > 0) {
    return node.nics;
  }

  const connectedEdges = edges.filter(
    (e) => e.source === node.id || e.target === node.id
  );
  const count = Math.max(1, connectedEdges.length);
  const defaultPrefix = node.ip.split('.').slice(0, 3).join('.') || '192.168.1';

  return Array.from({ length: count }, (_, idx) => ({
    id: `${node.id}-nic-${idx + 1}`,
    name: `Card mạng ${idx + 1}`,
    ipMode: idx === 0 && node.type === 'server' ? 'static' : 'dhcp',
    staticIp: idx === 0 ? node.ip : `${defaultPrefix}.${120 + idx}`,
    subnetMask: '255.255.255.0',
    gateway: `${defaultPrefix}.1`,
  }));
}

/**
 * Finds the best active DHCP provider (prefers dedicated `dhcp` server, then `router` with DHCP enabled)
 * reachable on the Layer-2 broadcast domain starting from `firstHopNodeId`.
 */
function findDhcpProviderOnSegment(
  clientNodeId: string,
  firstHopNodeId: string,
  nodeMap: Map<string, NetworkNode>,
  edges: NetworkEdge[]
): { provider: NetworkNode; pool: DhcpPoolConfig } | null {
  const firstNode = nodeMap.get(firstHopNodeId);
  if (!firstNode || firstNode.status !== 'active') return null;

  const visited = new Set<string>([clientNodeId]);
  const queue: string[] = [firstHopNodeId];
  visited.add(firstHopNodeId);

  const candidates: Array<{ provider: NetworkNode; pool: DhcpPoolConfig }> = [];

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const curr = nodeMap.get(currId);
    if (!curr || curr.status !== 'active') continue;

    if (curr.type === 'dhcp' || curr.type === 'router') {
      const pool = getDefaultDhcpPool(curr);
      if (pool.enabled) {
        candidates.push({ provider: curr, pool });
      }
    }

    // Only continue traversing across Layer-2 transparent bridges (switch, ap)
    if (!LAYER2_BRIDGE_TYPES.has(curr.type)) continue;

    for (const edge of edges) {
      if (edge.status !== 'active') continue;
      const neighborId =
        edge.source === currId
          ? edge.target
          : edge.target === currId
          ? edge.source
          : null;
      if (!neighborId || visited.has(neighborId)) continue;
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor || neighbor.status !== 'active') continue;
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }

  if (candidates.length === 0) return null;

  // Prefer dedicated DHCP Server over Router's built-in DHCP
  const dedicated = candidates.find((c) => c.provider.type === 'dhcp');
  return dedicated ?? candidates[0];
}

/**
 * Resolves live IP addresses, DHCP leases, and connection states for EVERY multi-NIC node in the diagram.
 * Returns a Map<nodeId, ResolvedNicState[]>.
 */
export function resolveAllNodeNics(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
): Map<string, ResolvedNicState[]> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result = new Map<string, ResolvedNicState[]>();

  // Track already-allocated IPs across all static nodes & DHCP leases so DHCP never duplicates an IP
  const usedIps = new Set<string>();
  for (const n of nodes) {
    if (!DEVICE_CATALOG_MAP[n.type]?.supportsMultiNic && n.ip) {
      usedIps.add(n.ip);
    }
    if (n.nics) {
      for (const nic of n.nics) {
        if (nic.ipMode === 'static' && nic.staticIp) {
          usedIps.add(nic.staticIp);
        }
      }
    }
  }

  // Track next host counter per DHCP provider ID
  const providerLeaseCursor = new Map<string, number>();

  for (const node of nodes) {
    const nics = getEffectiveNodeNics(node, edges);
    if (nics.length === 0) continue;

    // Match edges attached to this node -> specific NIC IDs
    const nodeEdges = edges.filter(
      (e) => e.source === node.id || e.target === node.id
    );

    const nicToEdge = new Map<string, NetworkEdge>();
    const unboundEdges: NetworkEdge[] = [];

    for (const edge of nodeEdges) {
      const explicitNicId =
        edge.source === node.id ? edge.sourceNicId : edge.targetNicId;
      if (
        explicitNicId &&
        nics.some((nic) => nic.id === explicitNicId) &&
        !nicToEdge.has(explicitNicId)
      ) {
        nicToEdge.set(explicitNicId, edge);
      } else {
        unboundEdges.push(edge);
      }
    }

    // Auto-bind any legacy/unbound edges to the first available free NICs
    for (const edge of unboundEdges) {
      const freeNic = nics.find((nic) => !nicToEdge.has(nic.id));
      if (freeNic) {
        nicToEdge.set(freeNic.id, edge);
      }
    }

    const resolvedList: ResolvedNicState[] = nics.map((nic) => {
      const edge = nicToEdge.get(nic.id);
      const peerId = edge
        ? edge.source === node.id
          ? edge.target
          : edge.source
        : undefined;
      const peerNode = peerId ? nodeMap.get(peerId) : undefined;

      const isPhysicallyConnected = Boolean(
        node.status === 'active' &&
          edge &&
          edge.status === 'active' &&
          peerNode &&
          peerNode.status === 'active'
      );

      if (node.status === 'offline') {
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: nic.ipMode,
          connected: false,
          edgeId: edge?.id,
          peerNodeId: peerId,
          peerLabel: peerNode?.label,
          effectiveIp: null,
          subnetMask: nic.subnetMask || '255.255.255.0',
          gateway: nic.gateway,
          statusNote: 'Thiết bị đang tắt nguồn',
        };
      }

      if (!edge || !peerNode) {
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: nic.ipMode,
          connected: false,
          effectiveIp: null,
          subnetMask: nic.subnetMask || '255.255.255.0',
          gateway: nic.gateway,
          statusNote: 'Chưa nối vào mạng nào',
        };
      }

      if (!isPhysicallyConnected) {
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: nic.ipMode,
          connected: false,
          edgeId: edge.id,
          peerNodeId: peerId,
          peerLabel: peerNode.label,
          effectiveIp: null,
          subnetMask: nic.subnetMask || '255.255.255.0',
          gateway: nic.gateway,
          statusNote:
            edge.status === 'down'
              ? 'Dây kết nối đang bị đứt'
              : `${peerNode.label} đang tắt nguồn`,
        };
      }

      // Static IP configuration
      if (nic.ipMode === 'static') {
        const cleanIp = nic.staticIp.trim();
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: 'static',
          connected: true,
          edgeId: edge.id,
          peerNodeId: peerId,
          peerLabel: peerNode.label,
          effectiveIp: cleanIp || null,
          subnetMask: nic.subnetMask || '255.255.255.0',
          gateway: nic.gateway,
          statusNote: cleanIp
            ? `Cấu hình tay · nối ${peerNode.label}`
            : 'Chưa nhập địa chỉ IP tĩnh',
        };
      }

      // DHCP dynamic lease discovery on this NIC's network segment
      const found = findDhcpProviderOnSegment(
        node.id,
        peerNode.id,
        nodeMap,
        edges
      );

      if (!found) {
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: 'dhcp',
          connected: true,
          edgeId: edge.id,
          peerNodeId: peerId,
          peerLabel: peerNode.label,
          effectiveIp: null,
          subnetMask: '255.255.255.0',
          statusNote:
            'Không tìm thấy DHCP Server/Router cấp IP trên mạng này',
        };
      }

      const { provider, pool } = found;
      let host = providerLeaseCursor.get(provider.id) ?? pool.startHost;
      let leasedIp: string | null = null;

      while (host <= pool.endHost) {
        const candidate = `${pool.networkPrefix}.${host}`;
        host += 1;
        if (!usedIps.has(candidate)) {
          usedIps.add(candidate);
          leasedIp = candidate;
          break;
        }
      }
      providerLeaseCursor.set(provider.id, host);

      if (!leasedIp) {
        return {
          nicId: nic.id,
          nicName: nic.name,
          ipMode: 'dhcp',
          connected: true,
          edgeId: edge.id,
          peerNodeId: peerId,
          peerLabel: peerNode.label,
          effectiveIp: null,
          subnetMask: pool.subnetMask,
          gateway: pool.gatewayIp,
          dhcpProviderLabel: provider.label,
          statusNote: `Hết dải IP cấp phát trên ${provider.label}`,
        };
      }

      return {
        nicId: nic.id,
        nicName: nic.name,
        ipMode: 'dhcp',
        connected: true,
        edgeId: edge.id,
        peerNodeId: peerId,
        peerLabel: peerNode.label,
        effectiveIp: leasedIp,
        subnetMask: pool.subnetMask,
        gateway: pool.gatewayIp,
        dhcpProviderLabel: provider.label,
        statusNote: `DHCP cấp bởi ${provider.label}`,
      };
    });

    result.set(node.id, resolvedList);
  }

  return result;
}

function describeNodeAction(
  node: NetworkNode,
  resolvedIp: string,
  activeNic: ResolvedNicState | undefined,
  isSource: boolean,
  isTarget: boolean,
  direction: 'outbound' | 'inbound',
  protocol: string,
  isBlocked: boolean
): { title: string; explanation: string } {
  const nicSuffix = activeNic
    ? ` qua ${activeNic.nicName} (IP: ${resolvedIp} · ${
        activeNic.ipMode === 'dhcp' ? 'DHCP' : 'Cấu hình tay'
      })`
    : ` (${resolvedIp})`;

  if (isBlocked) {
    return {
      title: 'Tường lửa phát hiện & chặn gói tin',
      explanation: `${node.label} đã kiểm tra gói tin ${protocol} bất thường và lập tức chặn đứng để bảo vệ các thiết bị phía sau.`,
    };
  }

  if (direction === 'outbound') {
    if (isSource) {
      return {
        title: `Khởi tạo gói tin ${protocol}`,
        explanation: `${node.label} đóng gói dữ liệu và gửi đi${nicSuffix}.`,
      };
    }
    if (isTarget) {
      return {
        title: 'Đích đến nhận gói tin thành công',
        explanation: `${node.label} đã nhận trọn vẹn yêu cầu ${protocol}${nicSuffix} và chuẩn bị xử lý.`,
      };
    }
  } else {
    if (isTarget) {
      return {
        title: 'Gửi dữ liệu phản hồi',
        explanation: `${node.label} xử lý xong yêu cầu và gửi gói tin phản hồi ngược về nơi xuất phát${nicSuffix}.`,
      };
    }
    if (isSource) {
      return {
        title: 'Hoàn tất vòng truyền dữ liệu',
        explanation: `${node.label} đã nhận được phản hồi đầy đủ${nicSuffix}.`,
      };
    }
  }

  switch (node.type) {
    case 'ap':
      return {
        title: 'Chuyển tiếp sóng Wi-Fi ↔ dây mạng',
        explanation: `${node.label} tiếp nhận tín hiệu không dây và chuyển đổi mượt mà sang đường dây cáp LAN (và ngược lại).`,
      };
    case 'switch':
      return {
        title: 'Chuyển mạch đúng cổng LAN',
        explanation: `${node.label} kiểm tra thiết bị đích trong mạng nội bộ và chuyển thẳng gói tin sang đúng cổng kết nối.`,
      };
    case 'router':
      return {
        title: 'Định tuyến & chọn đường đi',
        explanation: `${node.label} (${resolvedIp}) xác định đường đi ngắn nhất và thực hiện chuyển đổi địa chỉ NAT khi cần ra ngoài mạng.`,
      };
    case 'firewall':
      return {
        title: 'Kiểm tra an toàn bảo mật',
        explanation: `${node.label} quét nội dung gói tin ${protocol}, xác nhận hợp lệ và cho phép đi qua an toàn.`,
      };
    case 'modem':
      return {
        title: 'Giải điều chế tín hiệu cáp quang',
        explanation: `${node.label} chuyển đổi giữa tín hiệu cáp quang nhà mạng và tín hiệu mạng nội bộ.`,
      };
    case 'gateway':
      return {
        title: 'Đi qua cổng kết nối Gateway',
        explanation: `${node.label} (${resolvedIp}) đóng vai trò cửa ngõ chuyển đổi giao thức và đưa gói tin ${protocol} ra/vào mạng nội bộ.`,
      };
    case 'vpn':
      return {
        title: 'Mã hóa qua đường hầm VPN',
        explanation: `${node.label} bọc gói tin ${protocol} trong lớp mã hóa bảo mật để truyền an toàn qua mạng công cộng.`,
      };
    case 'loadbalancer':
      return {
        title: 'Phân phối tải sang máy chủ rảnh',
        explanation: `${node.label} kiểm tra sức tải các máy chủ phía sau và điều phối gói tin đến máy chủ phản hồi nhanh nhất.`,
      };
    case 'dns':
      return {
        title: 'Tra cứu địa chỉ IP từ tên miền',
        explanation: `${node.label} (${resolvedIp}) tra trong danh bạ tên miền để tìm ra địa chỉ IP chính xác cho gói tin.`,
      };
    case 'dhcp':
      return {
        title: 'Quản lý & cấp phát địa chỉ IP',
        explanation: `${node.label} (${resolvedIp}) xác nhận địa chỉ IP hợp lệ đã cấp cho thiết bị trong mạng nội bộ.`,
      };
    case 'internet':
      return {
        title: 'Đi qua hệ thống mạng Internet',
        explanation: `Gói tin di chuyển qua các nút mạng nhà cung cấp trên Internet để tìm đến đúng địa chỉ đích.`,
      };
    default:
      return {
        title: `Chuyển tiếp qua ${node.label}`,
        explanation: `${node.label} nhận gói tin${nicSuffix} và chuyển tiếp sang chặng tiếp theo trên đường truyền.`,
      };
  }
}

export function computePacketFlow(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  sourceId: string,
  targetId: string,
  scenarioId: PacketScenarioId,
  resolvedNicsMap?: Map<string, ResolvedNicState[]>
): ComputedPacketFlow {
  const nicMap = resolvedNicsMap ?? resolveAllNodeNics(nodes, edges);
  const scenario =
    PACKET_SCENARIOS.find((s) => s.id === scenarioId) ?? PACKET_SCENARIOS[0];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);

  if (!sourceNode || !targetNode) {
    return {
      reachable: false,
      errorMessage: 'Hãy chọn cả thiết bị gửi và thiết bị nhận để xem luồng gói tin.',
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  if (sourceId === targetId) {
    return {
      reachable: false,
      errorMessage: 'Thiết bị gửi và thiết bị nhận đang giống nhau. Hãy chọn hai thiết bị khác nhau.',
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  if (sourceNode.status === 'offline') {
    return {
      reachable: false,
      errorMessage: `${sourceNode.label} đang tắt nguồn. Hãy bật hoạt động trở lại trong mục Chi tiết.`,
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  if (targetNode.status === 'offline') {
    return {
      reachable: false,
      errorMessage: `${targetNode.label} đang tắt nguồn nên không thể nhận gói tin.`,
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  // Helper to verify whether a specific edge on a multi-NIC node has a valid IP
  const getEdgeNic = (nodeId: string, edgeId: string): ResolvedNicState | undefined => {
    const list = nicMap.get(nodeId);
    if (!list) return undefined;
    return list.find((n) => n.edgeId === edgeId);
  };

  // Build adjacency list from active edges & active nodes
  const adjacency = new Map<string, Array<{ neighborId: string; edge: NetworkEdge }>>();
  for (const n of nodes) {
    if (n.status === 'active') {
      adjacency.set(n.id, []);
    }
  }

  for (const edge of edges) {
    if (edge.status !== 'active') continue;
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b || a.status !== 'active' || b.status !== 'active') continue;
    adjacency.get(edge.source)?.push({ neighborId: edge.target, edge });
    adjacency.get(edge.target)?.push({ neighborId: edge.source, edge });
  }

  // BFS shortest path
  const queue: string[] = [sourceId];
  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { prevNodeId: string; edge: NetworkEdge }>();

  let found = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      found = true;
      break;
    }
    const neighbors = adjacency.get(current) ?? [];
    for (const { neighborId, edge } of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        parent.set(neighborId, { prevNodeId: current, edge });
        queue.push(neighborId);
      }
    }
  }

  if (!found) {
    return {
      reachable: false,
      errorMessage: `Không tìm thấy đường kết nối thông suốt giữa ${sourceNode.label} và ${targetNode.label}. Hãy kiểm tra lại dây nối hoặc thiết bị đang tắt.`,
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  // Reconstruct path
  const fullPathNodeIds: string[] = [];
  const fullPathEdges: NetworkEdge[] = [];
  let cursor = targetId;
  while (cursor !== sourceId) {
    fullPathNodeIds.unshift(cursor);
    const p = parent.get(cursor)!;
    fullPathEdges.unshift(p.edge);
    cursor = p.prevNodeId;
  }
  fullPathNodeIds.unshift(sourceId);

  // Check if the starting NIC or destination NIC has no IP (e.g. DHCP missing)
  const firstEdge = fullPathEdges[0];
  const lastEdge = fullPathEdges[fullPathEdges.length - 1];
  const sourceNic = firstEdge ? getEdgeNic(sourceId, firstEdge.id) : undefined;
  const targetNic = lastEdge ? getEdgeNic(targetId, lastEdge.id) : undefined;

  if (sourceNic && !sourceNic.effectiveIp) {
    return {
      reachable: false,
      errorMessage: `${sourceNode.label} (${sourceNic.nicName}) chưa có địa chỉ IP (${sourceNic.statusNote}). Hãy bật DHCP trên Router/DHCP Server hoặc cấu hình IP tay.`,
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  if (targetNic && !targetNic.effectiveIp) {
    return {
      reachable: false,
      errorMessage: `${targetNode.label} (${targetNic.nicName}) chưa có địa chỉ IP (${targetNic.statusNote}). Hãy bật DHCP hoặc cấu hình IP tay cho card mạng này.`,
      scenario,
      sourceId,
      targetId,
      outboundPathNodeIds: [],
      outboundEdgeIds: [],
      hops: [],
      totalLatencyMs: 0,
    };
  }

  // Check Firewall interception on threat scenario
  let blockedIndex = -1;
  if (scenario.isThreat) {
    for (let i = 1; i < fullPathNodeIds.length; i++) {
      const n = nodeMap.get(fullPathNodeIds[i])!;
      if (n.type === 'firewall' && n.blockThreats !== false) {
        blockedIndex = i;
        break;
      }
    }
  }

  const effectiveNodeIds =
    blockedIndex !== -1
      ? fullPathNodeIds.slice(0, blockedIndex + 1)
      : fullPathNodeIds;
  const effectiveEdges =
    blockedIndex !== -1 ? fullPathEdges.slice(0, blockedIndex) : fullPathEdges;

  const getAllConnectedIpsForNode = (nodeId: string) => {
    const list = nicMap.get(nodeId);
    if (!list) return undefined;
    const active = list
      .filter((n) => n.connected && n.effectiveIp)
      .map((n) => ({
        nicName: n.nicName,
        ip: n.effectiveIp!,
        ipMode: n.ipMode,
        peerLabel: n.peerLabel,
      }));
    return active.length > 0 ? active : undefined;
  };

  const hops: FlowHop[] = [];
  let totalLatency = 0;

  // Outbound hops
  for (let i = 0; i < effectiveNodeIds.length; i++) {
    const node = nodeMap.get(effectiveNodeIds[i])!;
    const incomingEdge = i > 0 ? effectiveEdges[i - 1] : undefined;
    const outgoingEdge =
      i < effectiveEdges.length ? effectiveEdges[i] : undefined;
    const relevantEdge = i === 0 ? outgoingEdge : incomingEdge;
    const activeNic = relevantEdge
      ? getEdgeNic(node.id, relevantEdge.id)
      : undefined;
    const resolvedIp = activeNic?.effectiveIp ?? node.ip;

    const hopLatency = incomingEdge
      ? CONNECTION_META[incomingEdge.type].latencyMs
      : 0;
    totalLatency += hopLatency;

    const isBlockedHere = blockedIndex !== -1 && i === blockedIndex;
    const isTargetHere = blockedIndex === -1 && i === effectiveNodeIds.length - 1;
    const { title, explanation } = describeNodeAction(
      node,
      resolvedIp,
      activeNic,
      i === 0,
      isTargetHere,
      'outbound',
      scenario.protocol,
      isBlockedHere
    );

    hops.push({
      stepIndex: hops.length,
      nodeId: node.id,
      nodeLabel: node.label,
      nodeType: node.type,
      nodeIp: resolvedIp,
      activeNicName: activeNic?.nicName,
      activeNicMode: activeNic?.ipMode,
      allConnectedIps: getAllConnectedIpsForNode(node.id),
      edgeId: incomingEdge?.id,
      edgeType: incomingEdge?.type,
      direction: 'outbound',
      actionTitle: title,
      explanation,
      latencyMs: hopLatency,
      status: isBlockedHere ? 'blocked' : isTargetHere ? 'delivered' : 'ok',
    });
  }

  // Inbound (return) hops if roundTrip and not blocked
  if (scenario.roundTrip && blockedIndex === -1) {
    for (let i = effectiveNodeIds.length - 2; i >= 0; i--) {
      const node = nodeMap.get(effectiveNodeIds[i])!;
      const returningEdge = effectiveEdges[i];
      const activeNic = returningEdge
        ? getEdgeNic(node.id, returningEdge.id)
        : undefined;
      const resolvedIp = activeNic?.effectiveIp ?? node.ip;
      const hopLatency = returningEdge
        ? CONNECTION_META[returningEdge.type].latencyMs
        : 2;
      totalLatency += hopLatency;

      const isBackAtSource = i === 0;
      const { title, explanation } = describeNodeAction(
        node,
        resolvedIp,
        activeNic,
        isBackAtSource,
        false,
        'inbound',
        scenario.protocol,
        false
      );

      hops.push({
        stepIndex: hops.length,
        nodeId: node.id,
        nodeLabel: node.label,
        nodeType: node.type,
        nodeIp: resolvedIp,
        activeNicName: activeNic?.nicName,
        activeNicMode: activeNic?.ipMode,
        allConnectedIps: getAllConnectedIpsForNode(node.id),
        edgeId: returningEdge?.id,
        edgeType: returningEdge?.type,
        direction: 'inbound',
        actionTitle: title,
        explanation,
        latencyMs: hopLatency,
        status: isBackAtSource ? 'delivered' : 'ok',
      });
    }
  }

  return {
    reachable: blockedIndex === -1,
    blockedAtNodeId:
      blockedIndex !== -1 ? effectiveNodeIds[blockedIndex] : undefined,
    scenario,
    sourceId,
    targetId,
    outboundPathNodeIds: effectiveNodeIds,
    outboundEdgeIds: effectiveEdges.map((e) => e.id),
    hops,
    totalLatencyMs: totalLatency,
  };
}

/**
 * Automatically arranges nodes cleanly from left-to-right based on logical network hierarchy
 */
export function autoLayoutNodes(
  nodes: NetworkNode[],
  edges: NetworkEdge[]
): NetworkNode[] {
  if (nodes.length === 0) return nodes;

  const rankPriority: Record<string, number> = {
    internet: 0,
    modem: 1,
    gateway: 2,
    vpn: 2,
    firewall: 2,
    router: 3,
    loadbalancer: 4,
    switch: 4,
    ap: 4,
    dns: 5,
    dhcp: 5,
    server: 5,
    nas: 5,
    pc: 5,
    laptop: 5,
    phone: 5,
    printer: 5,
    camera: 5,
  };

  const adjacency = new Map<string, string[]>();
  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((e) => {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  });

  const sortedByRole = [...nodes].sort(
    (a, b) => (rankPriority[a.type] ?? 5) - (rankPriority[b.type] ?? 5)
  );

  const layerMap = new Map<string, number>();
  const visited = new Set<string>();

  for (const seed of sortedByRole) {
    if (visited.has(seed.id)) continue;
    const baseLayer = Math.min(rankPriority[seed.type] ?? 0, 4);
    const queue: Array<{ id: string; depth: number }> = [
      { id: seed.id, depth: baseLayer },
    ];
    visited.add(seed.id);
    layerMap.set(seed.id, baseLayer);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const neighbors = adjacency.get(id) ?? [];
      for (const nId of neighbors) {
        if (!visited.has(nId)) {
          visited.add(nId);
          const nextDepth = depth + 1;
          layerMap.set(nId, nextDepth);
          queue.push({ id: nId, depth: nextDepth });
        }
      }
    }
  }

  const uniqueLayers = Array.from(new Set(layerMap.values())).sort((a, b) => a - b);
  const columns = new Map<number, NetworkNode[]>();
  uniqueLayers.forEach((_, idx) => columns.set(idx, []));

  for (const n of nodes) {
    const rawLayer = layerMap.get(n.id) ?? 0;
    const colIdx = uniqueLayers.indexOf(rawLayer);
    columns.get(colIdx)?.push(n);
  }

  const colSpacing = 240;
  const rowSpacing = 144;
  const startX = 112;
  const centerY = 272;

  const updatedMap = new Map<string, { x: number; y: number }>();

  columns.forEach((colNodes, colIdx) => {
    const totalHeight = (colNodes.length - 1) * rowSpacing;
    const startY = Math.max(80, Math.round((centerY - totalHeight / 2) / 16) * 16);
    colNodes.forEach((node, rowIdx) => {
      updatedMap.set(node.id, {
        x: startX + colIdx * colSpacing,
        y: startY + rowIdx * rowSpacing,
      });
    });
  });

  return nodes.map((n) => {
    const pos = updatedMap.get(n.id);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
}

export function generateNextIp(type: NetworkNode['type'], nodes: NetworkNode[]): string {
  const catalog = DEVICE_CATALOG_MAP[type];
  const prefix = catalog?.defaultIpPrefix ?? '192.168.1';
  const used = new Set(nodes.map((n) => n.ip));

  if (type === 'internet') return '8.8.8.8';
  if (type === 'router' && !used.has('192.168.1.1')) return '192.168.1.1';
  if (type === 'gateway' && !used.has('192.168.1.254')) return '192.168.1.254';
  if (type === 'dns' && !used.has('192.168.1.53')) return '192.168.1.53';
  if (type === 'dhcp' && !used.has('192.168.1.50')) return '192.168.1.50';
  if (type === 'vpn' && !used.has('10.8.0.1')) return '10.8.0.1';
  if (type === 'loadbalancer' && !used.has('10.0.0.5')) return '10.0.0.5';

  for (let host = 10; host < 250; host++) {
    const candidate = `${prefix}.${host}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}.${Math.floor(Math.random() * 200) + 10}`;
}

export function exportDiagramToSvg(
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  title = 'So-do-mang'
): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="100%" height="100%" fill="#F8FAFC"/><text x="400" y="200" text-anchor="middle" font-family="sans-serif" fill="#64748B">Sơ đồ trống</text></svg>`;
  }

  const nicMap = resolveAllNodeNics(nodes, edges);
  const padding = 80;
  const nodeW = 196;
  const getH = (n: NetworkNode) => {
    const resolved = nicMap.get(n.id);
    const connected = resolved?.filter((r) => r.connected && r.effectiveIp) ?? [];
    return connected.length > 1 ? 66 + connected.length * 16 : 78;
  };

  const minX = Math.min(...nodes.map((n) => n.x)) - padding;
  const minY = Math.min(...nodes.map((n) => n.y)) - padding;
  const maxX = Math.max(...nodes.map((n) => n.x + nodeW)) + padding;
  const maxY = Math.max(...nodes.map((n) => n.y + getH(n))) + padding;
  const width = Math.max(600, maxX - minX);
  const height = Math.max(400, maxY - minY);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const escapeXml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const edgeSvg = edges
    .map((e) => {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t) return '';
      const sx = s.x + nodeW / 2 - minX;
      const sy = s.y + getH(s) / 2 - minY;
      const tx = t.x + nodeW / 2 - minX;
      const ty = t.y + getH(t) / 2 - minY;
      const dx = Math.abs(tx - sx) * 0.45;
      const cx1 = sx < tx ? sx + dx : sx - dx;
      const cx2 = sx < tx ? tx - dx : tx + dx;
      const meta = CONNECTION_META[e.type];
      const stroke = e.status === 'down' ? '#DC2626' : meta.stroke;
      const dash =
        e.status === 'down'
          ? '4 4'
          : meta.dashArray
          ? meta.dashArray
          : '';
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2 - 8;
      return `
        <path d="M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}" fill="none" stroke="${stroke}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''} />
        <text x="${mx}" y="${my}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#475569">${escapeXml(meta.shortLabel)} · ${escapeXml(e.bandwidth)}</text>
      `;
    })
    .join('\n');

  const nodeSvg = nodes
    .map((n) => {
      const cat = DEVICE_CATALOG_MAP[n.type];
      const h = getH(n);
      const x = n.x - minX;
      const y = n.y - minY;
      const border = n.status === 'offline' ? '#94A3B8' : cat.accentColor;
      const resolved = nicMap.get(n.id);
      const connected = resolved?.filter((r) => r.connected && r.effectiveIp) ?? [];

      const ipLines =
        connected.length > 0
          ? connected
              .map(
                (r, idx) =>
                  `<text x="14" y="${46 + idx * 15}" font-family="monospace" font-size="10.5" fill="#475569">${escapeXml(r.effectiveIp!)} (${r.ipMode === 'dhcp' ? 'DHCP' : 'Tĩnh'})</text>`
              )
              .join('')
          : `<text x="14" y="47" font-family="monospace" font-size="11" fill="#64748B">${escapeXml(n.ip)}</text>`;

      return `
        <g transform="translate(${x}, ${y})">
          <rect width="${nodeW}" height="${h}" rx="12" fill="#FFFFFF" stroke="${border}" stroke-width="1.8" />
          <text x="14" y="26" font-family="sans-serif" font-size="13" font-weight="600" fill="#0F172A">${escapeXml(n.label)}</text>
          ${ipLines}
          <text x="14" y="${h - 10}" font-family="sans-serif" font-size="10" fill="${cat.accentColor}">${escapeXml(cat.shortName)}${n.status === 'offline' ? ' (Đang tắt)' : ''}</text>
        </g>
      `;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#F8FAFC" />
  <text x="24" y="34" font-family="sans-serif" font-size="16" font-weight="700" fill="#0F172A">${escapeXml(title)}</text>
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}
