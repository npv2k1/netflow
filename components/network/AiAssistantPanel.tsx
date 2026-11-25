'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  AiAnalysisResult,
  AiGeneratedDiagram,
  NetworkEdge,
  NetworkNode,
} from '@/lib/network/types';

interface AiAssistantPanelProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  onApplyAiDiagram: (diagram: AiGeneratedDiagram) => void;
  onRunSuggestedSimulation: (sim: NonNullable<AiGeneratedDiagram['suggestedSimulation']>) => void;
}

const PROMPT_SUGGESTIONS = [
  {
    label: 'Quán cà phê 2 tầng',
    prompt:
      'Vẽ sơ đồ mạng cho quán cà phê 2 tầng gồm Internet cáp quang, Modem, Router chính, máy thu ngân POS, máy in hóa đơn và 2 điểm phát Wi-Fi cho tầng 1 và tầng 2.',
  },
  {
    label: 'Văn phòng 15 người bảo mật',
    prompt:
      'Thiết kế sơ đồ mạng văn phòng nhỏ 15 nhân viên có tường lửa bảo vệ, Router, Switch chia dây cho 3 PC, 1 máy in chung, 1 ổ lưu trữ NAS và 1 Wi-Fi cho laptop.',
  },
  {
    label: 'Nhà thông minh có Camera',
    prompt:
      'Vẽ mạng gia đình nhà 3 tầng có Internet, Modem, Router Wi-Fi tầng 1, 2 Wi-Fi phụ cho tầng 2 và 3, 2 camera an ninh, 1 ổ lưu trữ NAS và điện thoại.',
  },
  {
    label: 'Thêm tường lửa & Camera',
    prompt:
      'Thêm 1 tường lửa bảo vệ ngay trước Router và gắn thêm 2 camera an ninh vào mạng hiện tại.',
  },
];

export function AiAssistantPanel({
  nodes,
  edges,
  onApplyAiDiagram,
  onRunSuggestedSimulation,
}: AiAssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'generate' | 'modify'>('generate');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastDiagram, setLastDiagram] = useState<AiGeneratedDiagram | null>(
    null
  );
  const [analysis, setAnalysis] = useState<AiAnalysisResult | null>(null);

  const handleGenerate = async (customPrompt?: string, customMode?: 'generate' | 'modify') => {
    const textToSend = (customPrompt ?? prompt).trim();
    const actionMode = customMode ?? (nodes.length === 0 ? 'generate' : mode);
    if (!textToSend) {
      setErrorMsg('Hãy nhập mô tả nhu cầu mạng của bạn trước khi nhờ AI vẽ.');
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);

    try {
      const res = await fetch('/api/network-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionMode,
          prompt: textToSend,
          nodes,
          edges,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Không thể tạo sơ đồ mạng lúc này.');
      }

      if (data.diagram) {
        setLastDiagram(data.diagram);
        setAnalysis(null);
        onApplyAiDiagram(data.diagram);
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Đã xảy ra lỗi kết nối tới trợ lý AI.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnalyze = async () => {
    if (nodes.length === 0) {
      setErrorMsg('Bảng vẽ đang trống. Hãy tạo sơ đồ trước khi kiểm tra.');
      return;
    }

    setErrorMsg(null);
    setIsAnalyzing(true);

    try {
      const res = await fetch('/api/network-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          nodes,
          edges,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Không thể phân tích sơ đồ mạng lúc này.');
      }

      if (data.analysis) {
        setAnalysis(data.analysis);
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Đã xảy ra lỗi khi phân tích sơ đồ.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-900">
            Mô tả mạng bằng lời nói thường
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            Không cần biết kỹ thuật. Chỉ cần kể bạn dùng mạng cho nhà ở, quán xá hay công ty, AI sẽ tự động vẽ và nối dây giúp bạn.
          </p>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setMode('generate')}
            className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'generate'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Vẽ sơ đồ mới
          </button>
          <button
            type="button"
            onClick={() => setMode('modify')}
            disabled={nodes.length === 0}
            className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap disabled:opacity-40 ${
              mode === 'modify'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sửa sơ đồ hiện tại
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleGenerate();
          }}
          className="space-y-2.5"
        >
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'modify'
                ? 'Ví dụ: Thêm 1 tường lửa bảo vệ và 2 camera an ninh nối vào Switch...'
                : 'Ví dụ: Vẽ mạng cho cửa hàng bán lẻ có 1 máy thu ngân, 1 máy in hóa đơn, Wi-Fi cho khách và 2 camera...'
            }
            className="w-full p-3 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:border-sky-600 focus:bg-white leading-relaxed"
          />

          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="w-full h-9 px-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>AI đang thiết kế sơ đồ...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                <span>
                  {mode === 'modify'
                    ? 'Cập nhật sơ đồ bằng AI'
                    : 'Tạo sơ đồ mạng bằng AI'}
                </span>
              </>
            )}
          </button>
        </form>

        {/* Quick 1-click prompt ideas */}
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-medium text-slate-500">
            Gợi ý thử nhanh:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_SUGGESTIONS.map((item, idx) => (
              <button
                key={item.label}
                type="button"
                disabled={isGenerating}
                onClick={() => {
                  const suggestedMode =
                    idx === 3 && nodes.length > 0 ? 'modify' : 'generate';
                  setMode(suggestedMode);
                  setPrompt(item.prompt);
                  handleGenerate(item.prompt, suggestedMode);
                }}
                className="px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-sky-50 hover:text-sky-800 border border-slate-200 hover:border-sky-200 rounded-md transition-colors text-left"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{errorMsg}</span>
        </div>
      )}

      {/* Last AI generation result */}
      {lastDiagram && (
        <div className="p-4 border-b border-slate-200 space-y-2.5 bg-sky-50/40">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <Sparkles className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <span>{lastDiagram.title}</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">
            {lastDiagram.explanation}
          </p>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {lastDiagram.nodes.length} thiết bị · {lastDiagram.edges.length} kết nối
          </div>
          {lastDiagram.suggestedSimulation && (
            <button
              type="button"
              onClick={() =>
                onRunSuggestedSimulation(lastDiagram.suggestedSimulation!)
              }
              className="w-full h-8 px-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-sky-800 bg-white border border-sky-200 hover:bg-sky-50 rounded-lg transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Xem thử luồng gói tin AI gợi ý</span>
            </button>
          )}
        </div>
      )}

      {/* AI Topology Reviewer */}
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-slate-900">
            Kiểm tra &amp; giải thích sơ đồ
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            AI sẽ đọc sơ đồ hiện tại trên bảng vẽ để kiểm tra thiết bị chưa nối dây, điểm nghẽn hoặc lỗ hổng bảo mật.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={isAnalyzing || nodes.length === 0}
          className="w-full h-9 px-4 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Đang kiểm tra sơ đồ...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Nhờ AI kiểm tra sơ đồ hiện tại</span>
            </>
          )}
        </button>

        {analysis && (
          <div className="pt-2 space-y-3 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Kết quả đánh giá
              </span>
              <span
                className={`text-xs font-semibold ${
                  analysis.riskLevel === 'an_toan'
                    ? 'text-emerald-700'
                    : analysis.riskLevel === 'co_loi'
                    ? 'text-red-700'
                    : 'text-amber-700'
                }`}
              >
                {analysis.riskLevel === 'an_toan'
                  ? 'Ổn định & an toàn'
                  : analysis.riskLevel === 'co_loi'
                  ? 'Cần khắc phục'
                  : 'Có thể tối ưu thêm'}
              </span>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              {analysis.summary}
            </p>

            {analysis.strengths.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-emerald-700">
                  Điểm hợp lý
                </div>
                <ul className="space-y-1.5">
                  {analysis.strengths.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-slate-700 leading-snug"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.suggestions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-amber-700">
                  Gợi ý cải thiện
                </div>
                <ul className="space-y-1.5">
                  {analysis.suggestions.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-slate-700 leading-snug"
                    >
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
