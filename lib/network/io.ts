import {
  ConnectionType,
  DeviceType,
  DhcpPoolConfig,
  NetworkEdge,
  NetworkInterface,
  NetworkNode,
  PacketScenarioId,
} from './types';

const VALID_DEVICE_TYPES = new Set<DeviceType>([
  'internet',
  'modem',
  'gateway',
  'firewall',
  'vpn',
  'router',
  'switch',
  'loadbalancer',
  'ap',
  'pc',
  'laptop',
  'phone',
  'printer',
  'camera',
  'server',
  'dns',
  'dhcp',
  'nas',
]);

const VALID_EDGE_TYPES = new Set<ConnectionType>(['fiber', 'ethernet', 'wifi']);

const VALID_SCENARIOS = new Set<PacketScenarioId>([
  'web_https',
  'local_print',
  'dns_lookup',
  'threat_attack',
]);

export interface ExportedDiagramPayload {
  schemaVersion: 1;
  app: 'NetFlow Studio';
  exportedAt: string;
  title: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  simulation?: {
    sourceId: string;
    targetId: string;
    scenarioId: PacketScenarioId;
  };
}

export interface ParsedDiagramResult {
  ok: true;
  title: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  simulation?: {
    sourceId: string;
    targetId: string;
    scenarioId: PacketScenarioId;
  };
}

export interface ParsedDiagramError {
  ok: false;
  error: string;
}

export function serializeDiagramToJson(params: {
  title: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  simSourceId: string;
  simTargetId: string;
  scenarioId: PacketScenarioId;
}): string {
  const payload: ExportedDiagramPayload = {
    schemaVersion: 1,
    app: 'NetFlow Studio',
    exportedAt: new Date().toISOString(),
    title: params.title.trim() || 'Sơ đồ mạng',
    nodes: params.nodes,
    edges: params.edges,
    simulation:
      params.simSourceId && params.simTargetId
        ? {
            sourceId: params.simSourceId,
            targetId: params.simTargetId,
            scenarioId: params.scenarioId,
          }
        : undefined,
  };
  return JSON.stringify(payload, null, 2);
}

function sanitizeNics(
  rawNics: unknown,
  nodeId: string,
  fallbackIp: string
): NetworkInterface[] | undefined {
  if (!Array.isArray(rawNics) || rawNics.length === 0) return undefined;
  const seen = new Set<string>();
  const result: NetworkInterface[] = [];

  rawNics.slice(0, 16).forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    let id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, 64)
        : `${nodeId}-nic-${idx + 1}`;
    while (seen.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    seen.add(id);

    const staticIp =
      typeof obj.staticIp === 'string' && obj.staticIp.trim()
        ? obj.staticIp.trim().slice(0, 45)
        : fallbackIp;
    const subnetMask =
      typeof obj.subnetMask === 'string' && obj.subnetMask.trim()
        ? obj.subnetMask.trim().slice(0, 45)
        : '255.255.255.0';
    const gateway =
      typeof obj.gateway === 'string' && obj.gateway.trim()
        ? obj.gateway.trim().slice(0, 45)
        : undefined;

    result.push({
      id,
      name:
        typeof obj.name === 'string' && obj.name.trim()
          ? obj.name.trim().slice(0, 40)
          : `Card mạng ${idx + 1}`,
      ipMode: obj.ipMode === 'static' ? 'static' : 'dhcp',
      staticIp,
      subnetMask,
      gateway,
    });
  });

  return result.length > 0 ? result : undefined;
}

function sanitizeDhcpPool(rawPool: unknown): DhcpPoolConfig | undefined {
  if (!rawPool || typeof rawPool !== 'object') return undefined;
  const obj = rawPool as Record<string, unknown>;
  const startHost = Number(obj.startHost);
  const endHost = Number(obj.endHost);
  return {
    enabled: Boolean(obj.enabled),
    networkPrefix:
      typeof obj.networkPrefix === 'string' && obj.networkPrefix.trim()
        ? obj.networkPrefix.trim().slice(0, 32)
        : '192.168.1',
    startHost:
      Number.isFinite(startHost) && startHost >= 2 && startHost <= 250
        ? Math.round(startHost)
        : 100,
    endHost:
      Number.isFinite(endHost) && endHost >= 2 && endHost <= 254
        ? Math.round(endHost)
        : 200,
    subnetMask:
      typeof obj.subnetMask === 'string' && obj.subnetMask.trim()
        ? obj.subnetMask.trim().slice(0, 45)
        : '255.255.255.0',
    gatewayIp:
      typeof obj.gatewayIp === 'string' && obj.gatewayIp.trim()
        ? obj.gatewayIp.trim().slice(0, 45)
        : '192.168.1.1',
  };
}

export function parseImportedDiagram(
  rawText: string
): ParsedDiagramResult | ParsedDiagramError {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Nội dung tệp đang trống.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: 'Tệp không đúng định dạng JSON hợp lệ. Hãy chọn tệp .json đã xuất từ NetFlow Studio.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Cấu trúc tệp sơ đồ không hợp lệ.' };
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.nodes)) {
    return {
      ok: false,
      error: 'Không tìm thấy danh sách thiết bị (nodes) trong tệp JSON.',
    };
  }

  const seenNodeIds = new Set<string>();
  const nodes: NetworkNode[] = [];

  root.nodes.slice(0, 100).forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    let id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, 64)
        : `imp-node-${idx + 1}`;
    while (seenNodeIds.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    seenNodeIds.add(id);

    const type: DeviceType = VALID_DEVICE_TYPES.has(obj.type as DeviceType)
      ? (obj.type as DeviceType)
      : 'pc';
    const ip =
      typeof obj.ip === 'string' && obj.ip.trim()
        ? obj.ip.trim().slice(0, 45)
        : `192.168.1.${10 + idx}`;
    const rawX = Number(obj.x);
    const rawY = Number(obj.y);

    nodes.push({
      id,
      type,
      label:
        typeof obj.label === 'string' && obj.label.trim()
          ? obj.label.trim().slice(0, 60)
          : `Thiết bị ${idx + 1}`,
      ip,
      x: Number.isFinite(rawX) ? Math.round(rawX) : 120 + (idx % 4) * 220,
      y: Number.isFinite(rawY) ? Math.round(rawY) : 120 + Math.floor(idx / 4) * 140,
      status: obj.status === 'offline' ? 'offline' : 'active',
      blockThreats:
        typeof obj.blockThreats === 'boolean'
          ? obj.blockThreats
          : type === 'firewall'
          ? true
          : undefined,
      nics: sanitizeNics(obj.nics, id, ip),
      dhcpPool: sanitizeDhcpPool(obj.dhcpPool),
      note:
        typeof obj.note === 'string' ? obj.note.slice(0, 200) : undefined,
    });
  });

  if (nodes.length === 0) {
    return {
      ok: false,
      error: 'Tệp sơ đồ không chứa thiết bị hợp lệ nào.',
    };
  }

  const edges: NetworkEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const rawEdges = Array.isArray(root.edges) ? root.edges : [];

  rawEdges.slice(0, 250).forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const source = typeof obj.source === 'string' ? obj.source.trim() : '';
    const target = typeof obj.target === 'string' ? obj.target.trim() : '';
    if (!seenNodeIds.has(source) || !seenNodeIds.has(target) || source === target) {
      return;
    }

    let id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, 64)
        : `imp-edge-${idx + 1}`;
    while (seenEdgeIds.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    seenEdgeIds.add(id);

    const type: ConnectionType = VALID_EDGE_TYPES.has(obj.type as ConnectionType)
      ? (obj.type as ConnectionType)
      : 'ethernet';

    edges.push({
      id,
      source,
      target,
      sourceNicId:
        typeof obj.sourceNicId === 'string' && obj.sourceNicId.trim()
          ? obj.sourceNicId.trim().slice(0, 64)
          : undefined,
      targetNicId:
        typeof obj.targetNicId === 'string' && obj.targetNicId.trim()
          ? obj.targetNicId.trim().slice(0, 64)
          : undefined,
      type,
      bandwidth:
        typeof obj.bandwidth === 'string' && obj.bandwidth.trim()
          ? obj.bandwidth.trim().slice(0, 32)
          : type === 'wifi'
          ? '300 Mbps'
          : '1 Gbps',
      status: obj.status === 'down' ? 'down' : 'active',
    });
  });

  let simulation: ParsedDiagramResult['simulation'];
  if (root.simulation && typeof root.simulation === 'object') {
    const sim = root.simulation as Record<string, unknown>;
    const sId = typeof sim.sourceId === 'string' ? sim.sourceId : '';
    const tId = typeof sim.targetId === 'string' ? sim.targetId : '';
    if (seenNodeIds.has(sId) && seenNodeIds.has(tId) && sId !== tId) {
      simulation = {
        sourceId: sId,
        targetId: tId,
        scenarioId: VALID_SCENARIOS.has(sim.scenarioId as PacketScenarioId)
          ? (sim.scenarioId as PacketScenarioId)
          : 'web_https',
      };
    }
  }

  const title =
    typeof root.title === 'string' && root.title.trim()
      ? root.title.trim().slice(0, 80)
      : 'Sơ đồ đã nhập';

  return {
    ok: true,
    title,
    nodes,
    edges,
    simulation,
  };
}

export function slugifyFilename(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return normalized || 'so-do-mang';
}

export async function renderSvgToPngBlob(svgText: string): Promise<Blob> {
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể chuyển đổi SVG sang ảnh PNG.'));
      image.src = url;
    });

    const scale = 2;
    const width = Math.max(600, img.naturalWidth || 1000);
    const height = Math.max(400, img.naturalHeight || 600);

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xuất ảnh PNG.');
    }

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!pngBlob) {
      throw new Error('Không thể tạo tệp ảnh PNG.');
    }
    return pngBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
