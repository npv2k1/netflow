export type DeviceType =
  | 'internet'
  | 'modem'
  | 'gateway'
  | 'firewall'
  | 'vpn'
  | 'router'
  | 'switch'
  | 'loadbalancer'
  | 'ap'
  | 'pc'
  | 'laptop'
  | 'phone'
  | 'printer'
  | 'camera'
  | 'server'
  | 'dns'
  | 'dhcp'
  | 'nas';

export type DeviceCategory = 'gateway' | 'distribution' | 'endpoints' | 'servers';

export type ConnectionType = 'fiber' | 'ethernet' | 'wifi';

export type PacketScenarioId = 'web_https' | 'local_print' | 'dns_lookup' | 'threat_attack';

export type IpAssignmentMode = 'dhcp' | 'static';

export interface NetworkInterface {
  id: string;
  name: string;
  ipMode: IpAssignmentMode;
  staticIp: string;
  subnetMask: string;
  gateway?: string;
}

export interface DhcpPoolConfig {
  enabled: boolean;
  networkPrefix: string; // e.g., "192.168.1"
  startHost: number; // e.g., 100
  endHost: number; // e.g., 200
  subnetMask: string; // e.g., "255.255.255.0"
  gatewayIp: string; // e.g., "192.168.1.1"
}

export interface ResolvedNicState {
  nicId: string;
  nicName: string;
  ipMode: IpAssignmentMode;
  connected: boolean;
  edgeId?: string;
  peerNodeId?: string;
  peerLabel?: string;
  effectiveIp: string | null;
  subnetMask: string;
  gateway?: string;
  dhcpProviderLabel?: string;
  statusNote: string;
}

export interface NetworkNode {
  id: string;
  type: DeviceType;
  label: string;
  ip: string;
  x: number;
  y: number;
  status: 'active' | 'offline';
  blockThreats?: boolean; // For firewall nodes
  nics?: NetworkInterface[]; // Multi-NIC support (PC, Laptop, Server, NAS, etc.)
  dhcpPool?: DhcpPoolConfig; // DHCP Server / Router DHCP pool config
  note?: string;
}

export interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  sourceNicId?: string;
  targetNicId?: string;
  type: ConnectionType;
  bandwidth: string;
  status: 'active' | 'down';
}

export interface DeviceCatalogItem {
  type: DeviceType;
  name: string;
  shortName: string;
  category: DeviceCategory;
  simpleDesc: string;
  roleAnalogy: string;
  defaultIpPrefix: string;
  defaultEdgeType: ConnectionType;
  accentColor: string;
  bgTint: string;
  borderTint: string;
  supportsMultiNic?: boolean;
  supportsDhcpServer?: boolean;
}

export interface PacketScenario {
  id: PacketScenarioId;
  name: string;
  protocol: string;
  summary: string;
  color: string;
  isThreat?: boolean;
  roundTrip: boolean;
}

export interface FlowHop {
  stepIndex: number;
  nodeId: string;
  nodeLabel: string;
  nodeType: DeviceType;
  nodeIp: string;
  activeNicName?: string;
  activeNicMode?: IpAssignmentMode;
  allConnectedIps?: Array<{
    nicName: string;
    ip: string;
    ipMode: IpAssignmentMode;
    peerLabel?: string;
  }>;
  edgeId?: string;
  edgeType?: ConnectionType;
  direction: 'outbound' | 'inbound';
  actionTitle: string;
  explanation: string;
  latencyMs: number;
  status: 'ok' | 'blocked' | 'delivered';
}

export interface ComputedPacketFlow {
  reachable: boolean;
  blockedAtNodeId?: string;
  errorMessage?: string;
  scenario: PacketScenario;
  sourceId: string;
  targetId: string;
  outboundPathNodeIds: string[];
  outboundEdgeIds: string[];
  hops: FlowHop[];
  totalLatencyMs: number;
}

export interface NetworkTemplate {
  id: string;
  name: string;
  subtitle: string;
  audience: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  defaultSimulation: {
    sourceId: string;
    targetId: string;
    scenarioId: PacketScenarioId;
  };
}

export interface AiAnalysisResult {
  summary: string;
  strengths: string[];
  suggestions: string[];
  riskLevel: 'an_toan' | 'can_chu_y' | 'co_loi';
}

export interface AiGeneratedDiagram {
  title: string;
  explanation: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  suggestedSimulation?: {
    sourceId: string;
    targetId: string;
    scenarioId: PacketScenarioId;
  };
}
