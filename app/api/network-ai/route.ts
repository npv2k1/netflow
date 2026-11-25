import { GoogleGenAI, Type } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import {
  AiAnalysisResult,
  AiGeneratedDiagram,
  ConnectionType,
  DeviceType,
  NetworkEdge,
  NetworkNode,
  PacketScenarioId,
} from '@/lib/network/types';
import { autoLayoutNodes } from '@/lib/network/simulation';
import { isGeminiConfigured } from '@/lib/network/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

function getGeminiClient() {
  if (!isGeminiConfigured()) {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function GET() {
  return NextResponse.json({ enabled: isGeminiConfigured() });
}

export async function POST(req: NextRequest) {
  try {
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        {
          error: 'Tính năng AI hiện đang tắt vì chưa cấu hình GEMINI_API_KEY.',
          aiDisabled: true,
        },
        { status: 503 }
      );
    }

    const body = await req.json();
    const action: 'generate' | 'modify' | 'analyze' = body?.action ?? 'generate';
    const prompt: string =
      typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 1500) : '';
    const currentNodes: NetworkNode[] = Array.isArray(body?.nodes)
      ? body.nodes.slice(0, 50)
      : [];
    const currentEdges: NetworkEdge[] = Array.isArray(body?.edges)
      ? body.edges.slice(0, 100)
      : [];

    const ai = getGeminiClient();

    if (action === 'analyze') {
      if (currentNodes.length === 0) {
        return NextResponse.json(
          { error: 'Sơ đồ đang trống. Hãy thêm vài thiết bị trước khi nhờ AI kiểm tra.' },
          { status: 400 }
        );
      }

      const topologySummary = JSON.stringify({
        devices: currentNodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.label,
          ip: n.ip,
          status: n.status,
          blockThreats: n.blockThreats,
          nics: n.nics,
          dhcpPool: n.dhcpPool,
        })),
        connections: currentEdges.map((e) => ({
          source: e.source,
          target: e.target,
          type: e.type,
          bandwidth: e.bandwidth,
          status: e.status,
        })),
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Phân tích sơ đồ mạng sau đây dành cho người không chuyên bằng tiếng Việt dễ hiểu:\n${topologySummary}`,
        config: {
          systemInstruction:
            'Bạn là chuyên gia mạng thân thiện giải thích cho người không chuyên bằng tiếng Việt rõ ràng, ngắn gọn, không dùng thuật ngữ quá khó hiểu. Phân tích sơ đồ mạng hiện có: tóm tắt cách mạng đang hoạt động (2-3 câu), nêu điểm tốt (2-3 ý), và gợi ý cải thiện thực tế (ví dụ: thiết bị chưa nối dây, thiếu tường lửa, dây nối bị đứt, thiết bị đang tắt, hoặc cách tối ưu Wi-Fi).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Tóm tắt ngắn gọn cách sơ đồ mạng đang hoạt động bằng tiếng Việt dễ hiểu.',
              },
              riskLevel: {
                type: Type.STRING,
                description: 'Một trong ba giá trị: an_toan, can_chu_y, co_loi',
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2-3 điểm tốt của sơ đồ mạng.',
              },
              suggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2-4 gợi ý cải thiện thực tế, dễ làm ngay.',
              },
            },
            required: ['summary', 'riskLevel', 'strengths', 'suggestions'],
          },
        },
      });

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw) as AiAnalysisResult;
      const riskLevel =
        parsed.riskLevel === 'an_toan' ||
        parsed.riskLevel === 'can_chu_y' ||
        parsed.riskLevel === 'co_loi'
          ? parsed.riskLevel
          : 'can_chu_y';

      return NextResponse.json({
        analysis: {
          summary: parsed.summary || 'Đã hoàn tất phân tích sơ đồ mạng của bạn.',
          riskLevel,
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        },
      });
    }

    // Generate or Modify mode
    if (!prompt) {
      return NextResponse.json(
        { error: 'Hãy nhập mô tả sơ đồ mạng bạn muốn AI vẽ.' },
        { status: 400 }
      );
    }

    const userPrompt =
      action === 'modify' && currentNodes.length > 0
        ? `Đây là sơ đồ mạng hiện tại:\n${JSON.stringify({
            nodes: currentNodes.map((n) => ({
              id: n.id,
              type: n.type,
              label: n.label,
              ip: n.ip,
            })),
            edges: currentEdges.map((e) => ({
              source: e.source,
              target: e.target,
              type: e.type,
              bandwidth: e.bandwidth,
            })),
          })}\n\nYêu cầu chỉnh sửa / mở rộng từ người dùng: "${prompt}"\nHãy trả về toàn bộ sơ đồ mạng hoàn chỉnh sau khi đã cập nhật theo yêu cầu.`
        : `Hãy thiết kế một sơ đồ mạng thực tế, rõ ràng và dễ hiểu cho yêu cầu sau: "${prompt}"`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userPrompt,
      config: {
        systemInstruction: `Bạn là kiến trúc sư mạng thân thiện hỗ trợ người không chuyên vẽ sơ đồ mạng bằng tiếng Việt.
Quy tắc bắt buộc:
1. Chỉ sử dụng các loại thiết bị (type) hợp lệ sau: internet, modem, gateway, firewall, vpn, router, switch, loadbalancer, ap, pc, laptop, phone, printer, camera, server, dns, dhcp, nas.
2. Chỉ sử dụng các loại kết nối (type) hợp lệ sau: fiber (cáp quang nối Internet/Modem/Gateway/VPN), ethernet (cáp mạng LAN nối thiết bị cố định/switch/router/AP/server/dns/dhcp/loadbalancer), wifi (sóng không dây nối điện thoại/laptop với router hoặc AP).
3. Đặt tên thiết bị (label) bằng tiếng Việt ngắn gọn, dễ hiểu (ví dụ: "Gateway chính", "DNS Server nội bộ", "PC 2 Card mạng", "DHCP Server").
4. PC, Laptop, Server, NAS hỗ trợ nhiều card mạng (nics) với chế độ ipMode là "dhcp" hoặc "static" để kết nối đồng thời nhiều mạng khác nhau (ví dụ mạng 192.168.1.x và mạng 10.20.0.x). Nếu người dùng yêu cầu máy tính nối nhiều mạng hoặc dùng DHCP/IP tĩnh, hãy cấu hình mảng nics rõ ràng và gán IP prefix tương ứng trên Router/DHCP Server.
5. Tạo từ 4 đến 14 thiết bị tùy yêu cầu, đảm bảo tất cả thiết bị đều được kết nối hợp lý thành sơ đồ hoàn chỉnh.
6. Gợi ý một luồng gói tin hay nhất (suggestedSimulation) với sourceId, targetId và scenarioId (web_https, local_print, dns_lookup, hoặc threat_attack).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Tên ngắn gọn cho sơ đồ mạng bằng tiếng Việt.',
            },
            explanation: {
              type: Type.STRING,
              description:
                'Giải thích thân thiện 2-3 câu cho người không chuyên về cách sơ đồ này vận hành.',
            },
            nodes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: 'ID duy nhất ngắn, ví dụ n1, n2' },
                  type: {
                    type: Type.STRING,
                    description:
                      'internet | modem | gateway | firewall | vpn | router | switch | loadbalancer | ap | pc | laptop | phone | printer | camera | server | dns | dhcp | nas',
                  },
                  label: { type: Type.STRING, description: 'Tên tiếng Việt ngắn gọn' },
                  ip: { type: Type.STRING, description: 'Địa chỉ IP hợp lệ, ví dụ 192.168.1.1' },
                  nics: {
                    type: Type.ARRAY,
                    description: 'Tùy chọn danh sách card mạng cho PC/Laptop/Server khi nối nhiều mạng hoặc chỉ định DHCP/static',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        ipMode: { type: Type.STRING, description: 'dhcp | static' },
                        staticIp: { type: Type.STRING },
                      },
                      required: ['name', 'ipMode', 'staticIp'],
                    },
                  },
                },
                required: ['id', 'type', 'label', 'ip'],
              },
            },
            edges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING, description: 'ID thiết bị nguồn' },
                  target: { type: Type.STRING, description: 'ID thiết bị đích' },
                  type: { type: Type.STRING, description: 'fiber | ethernet | wifi' },
                  bandwidth: { type: Type.STRING, description: 'Ví dụ: 1 Gbps, 500 Mbps, Wi-Fi 6' },
                },
                required: ['source', 'target', 'type', 'bandwidth'],
              },
            },
            suggestedSimulation: {
              type: Type.OBJECT,
              properties: {
                sourceId: { type: Type.STRING },
                targetId: { type: Type.STRING },
                scenarioId: {
                  type: Type.STRING,
                  description: 'web_https | local_print | dns_lookup | threat_attack',
                },
              },
              required: ['sourceId', 'targetId', 'scenarioId'],
            },
          },
          required: ['title', 'explanation', 'nodes', 'edges'],
        },
      },
    });

    const raw = (response.text ?? '{}').trim();
    const parsed = JSON.parse(raw);

    const rawNodes: Array<{
      id: string;
      type: string;
      label: string;
      ip: string;
      nics?: Array<{ name: string; ipMode: string; staticIp: string }>;
    }> = Array.isArray(parsed.nodes) ? parsed.nodes : [];

    const sanitizedNodes: NetworkNode[] = rawNodes.map((n, idx) => {
      const safeType: DeviceType = VALID_DEVICE_TYPES.has(n.type as DeviceType)
        ? (n.type as DeviceType)
        : 'pc';
      const nodeId = String(n.id || `ai-n-${idx + 1}`);
      const baseIp = String(n.ip || `192.168.1.${10 + idx}`);
      const sanitizedNics =
        Array.isArray(n.nics) && n.nics.length > 0
          ? n.nics.map((nic, nicIdx) => {
              const sIp = String(nic.staticIp || baseIp);
              const pfx = sIp.split('.').slice(0, 3).join('.') || '192.168.1';
              return {
                id: `${nodeId}-nic-${nicIdx + 1}`,
                name: String(nic.name || `Card mạng ${nicIdx + 1}`).slice(0, 32),
                ipMode: (nic.ipMode === 'static' ? 'static' : 'dhcp') as
                  | 'dhcp'
                  | 'static',
                staticIp: sIp,
                subnetMask: '255.255.255.0',
                gateway: `${pfx}.1`,
              };
            })
          : undefined;

      return {
        id: nodeId,
        type: safeType,
        label: String(n.label || `Thiết bị ${idx + 1}`).slice(0, 40),
        ip: baseIp,
        x: 120 + (idx % 4) * 200,
        y: 120 + Math.floor(idx / 4) * 140,
        status: 'active',
        blockThreats: safeType === 'firewall' ? true : undefined,
        nics: sanitizedNics,
      };
    });

    const nodeIds = new Set(sanitizedNodes.map((n) => n.id));
    const rawEdges: Array<{
      source: string;
      target: string;
      type: string;
      bandwidth: string;
    }> = Array.isArray(parsed.edges) ? parsed.edges : [];

    const edgeSet = new Set<string>();
    const sanitizedEdges: NetworkEdge[] = [];
    rawEdges.forEach((e, idx) => {
      const s = String(e.source || '');
      const t = String(e.target || '');
      if (!nodeIds.has(s) || !nodeIds.has(t) || s === t) return;
      const key = s < t ? `${s}__${t}` : `${t}__${s}`;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);

      const safeType: ConnectionType = VALID_EDGE_TYPES.has(e.type as ConnectionType)
        ? (e.type as ConnectionType)
        : 'ethernet';

      sanitizedEdges.push({
        id: `ai-e-${idx + 1}`,
        source: s,
        target: t,
        type: safeType,
        bandwidth: String(e.bandwidth || (safeType === 'wifi' ? '300 Mbps' : '1 Gbps')),
        status: 'active',
      });
    });

    const laidOutNodes = autoLayoutNodes(sanitizedNodes, sanitizedEdges);

    let suggestedSimulation: AiGeneratedDiagram['suggestedSimulation'];
    if (
      parsed.suggestedSimulation &&
      nodeIds.has(parsed.suggestedSimulation.sourceId) &&
      nodeIds.has(parsed.suggestedSimulation.targetId) &&
      parsed.suggestedSimulation.sourceId !== parsed.suggestedSimulation.targetId
    ) {
      const scenarioId: PacketScenarioId = VALID_SCENARIOS.has(
        parsed.suggestedSimulation.scenarioId
      )
        ? parsed.suggestedSimulation.scenarioId
        : 'web_https';
      suggestedSimulation = {
        sourceId: parsed.suggestedSimulation.sourceId,
        targetId: parsed.suggestedSimulation.targetId,
        scenarioId,
      };
    }

    const result: AiGeneratedDiagram = {
      title: String(parsed.title || 'Sơ đồ mạng do AI thiết kế'),
      explanation: String(
        parsed.explanation || 'Sơ đồ đã được bố trí hoàn chỉnh và sẵn sàng mô phỏng gói tin.'
      ),
      nodes: laidOutNodes,
      edges: sanitizedEdges,
      suggestedSimulation,
    };

    return NextResponse.json({ diagram: result });
  } catch (err: unknown) {
    console.error('Network AI API error:', err);
    const message = err instanceof Error ? err.message : String(err);

    if (message === 'MISSING_API_KEY' || message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
      return NextResponse.json(
        {
          error:
            'Chưa cấu hình khóa API Gemini hợp lệ. Vui lòng thiết lập biến môi trường GEMINI_API_KEY trên Vercel (Project Settings > Environment Variables) hoặc Settings > Secrets.',
        },
        { status: 500 }
      );
    }

    if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
      return NextResponse.json(
        {
          error:
            'Hệ thống AI đang vượt giới hạn lượt gọi tạm thời. Vui lòng thử lại sau vài giây.',
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Không thể xử lý yêu cầu AI lúc này. Vui lòng thử lại với mô tả ngắn gọn hơn.' },
      { status: 500 }
    );
  }
}
