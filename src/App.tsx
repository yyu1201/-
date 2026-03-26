import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Upload, AlertTriangle, CheckCircle, Video, FileText, Loader2, ShieldAlert, Info, Clock, X, Trash2 } from 'lucide-react';
import { cn } from './lib/utils';

// Initialize Gemini API lazily to prevent crash on load if key is missing
let ai: GoogleGenAI | null = null;
try {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.error("Failed to initialize Gemini API", e);
}

interface Finding {
  timestamp: string;
  issue: string;
  severity: 'Low' | 'Medium' | 'High';
  recommendation: string;
}

interface ModerationReport {
  status: 'Approved' | 'Rejected' | 'Needs Review';
  confidence: number;
  summary: string;
  findings: Finding[];
}

interface HistoryItem {
  id: string;
  date: string;
  fileName: string;
  report: ModerationReport;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const templates = [
    {
      name: '🌟 综合全面审核（推荐）',
      text: '请对视频进行全面的内容安全与合规审核。重点检查以下大类：\n1. 政治与地图合规：严格核查视频中出现的地图、国界线、行政区划及地理标注（如华东、华北等）是否正确，有无错位或漏绘。\n2. 暴恐与违禁：是否包含暴力、血腥、危险行为或违禁品。\n3. 色情与低俗：是否包含色情画面、低俗恶搞等不雅内容。\n4. 事实与常识：陈述的客观事实、科学常识、历史事件是否准确，有无明显常识性错误或虚假信息。\n5. 价值观：是否宣扬仇恨言论、歧视或不良价值观。'
    },
    {
      name: '🗺️ 地图与版图专项',
      text: '请进行“地图与国家版图合规”专项审核。仔细逐帧检查视频中出现的所有地图、地球仪、行政区划图：\n1. 检查中国版图是否完整（重点关注台湾岛、海南岛、南海诸岛、钓鱼岛、阿克赛钦、藏南地区等）。\n2. 检查各省级行政区、大区（如华东、华中、华南、西南、西北、东北、华北）的文字标注是否放置在正确的地理位置上，绝不能出现错位。\n3. 发现任何地图错误，请标记为严重违规（High）。'
    },
    {
      name: '📰 事实核查专项',
      text: '请进行“事实与常识核查”专项审核。忽略一般的画面违规，重点关注视频中的文案、旁白、字幕和图表：\n1. 检查引用的数据、历史事件、科学原理是否准确。\n2. 检查是否存在张冠李戴、断章取义的误导性信息。\n3. 检查画面内容与解说词是否矛盾。'
    }
  ];

  const [criteria, setCriteria] = useState<string>(templates[0].text);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<ModerationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('moderation_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  const saveToHistory = (fileName: string, newReport: ModerationReport) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      date: new Date().toLocaleString(),
      fileName,
      report: newReport
    };
    const updatedHistory = [newItem, ...history].slice(0, 50); // Keep last 50
    setHistory(updatedHistory);
    localStorage.setItem('moderation_history', JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('moderation_history');
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setReport(item.report);
    setFile(new File([], item.fileName)); // Dummy file for name display
    setPreviewUrl(null);
    setShowHistory(false);
    setError(null);
    setWarning('当前正在查看历史记录。由于浏览器安全限制，无法回放原视频文件。');
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 50 * 1024 * 1024) {
        setError('视频太大了！目前网页端最大支持 50MB 的视频。建议压缩视频或剪辑片段后再上传。');
        setWarning(null);
        return;
      }
      
      if (selectedFile.size > 20 * 1024 * 1024) {
        setWarning('您上传的视频较大（超过 20MB），浏览器处理和 AI 分析可能需要较长时间，请耐心等待。');
      } else {
        setWarning(null);
      }

      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
      setReport(null);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64Data = reader.result.split(',')[1];
          resolve(base64Data);
        } else {
          reject(new Error('Failed to convert file'));
        }
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleAnalyze = async () => {
    if (!file) return;
    
    if (!ai) {
      setError('系统未配置 AI 密钥 (GEMINI_API_KEY)。如果你是在 Vercel 部署的，请在 Vercel 的 Environment Variables 中添加你的密钥，然后重新部署。');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setReport(null);

    try {
      const base64Data = await fileToBase64(file);

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          status: {
            type: Type.STRING,
            description: "The overall status of the video: 'Approved', 'Rejected', or 'Needs Review'",
          },
          confidence: {
            type: Type.NUMBER,
            description: "Confidence score from 0 to 100",
          },
          summary: {
            type: Type.STRING,
            description: "A brief summary of the video content and the moderation decision in Chinese",
          },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: { type: Type.STRING, description: "Time in the video (e.g., '00:15')" },
                issue: { type: Type.STRING, description: "Description of the issue found in Chinese" },
                severity: { type: Type.STRING, description: "'Low', 'Medium', or 'High'" },
                recommendation: { type: Type.STRING, description: "Suggested action in Chinese" }
              },
              required: ["timestamp", "issue", "severity", "recommendation"]
            }
          }
        },
        required: ["status", "confidence", "summary", "findings"]
      };

      const prompt = `你是一个专业的视频内容审核员和事实核查员。请根据以下审核标准对提供的视频进行严格审查：\n\n审核标准：\n${criteria}\n\n请仔细观看视频画面并聆听音频，找出任何违反标准的地方，或者事实不准确的内容。返回JSON格式的报告。`;

      const modelName = 'gemini-3.1-pro-preview';
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: file.type,
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          temperature: 0.2,
        },
      });

      if (response.text) {
        let cleanJson = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        try {
          const parsedReport = JSON.parse(cleanJson) as any;
          
          // Validate structure to prevent React render crashes
          if (typeof parsedReport !== 'object' || parsedReport === null) {
            throw new Error('Invalid response format');
          }
          
          const safeReport: ModerationReport = {
            status: typeof parsedReport.status === 'string' ? parsedReport.status as any : 'Needs Review',
            confidence: typeof parsedReport.confidence === 'number' ? parsedReport.confidence : 0,
            summary: typeof parsedReport.summary === 'string' ? parsedReport.summary : JSON.stringify(parsedReport.summary || '无摘要'),
            findings: Array.isArray(parsedReport.findings) ? parsedReport.findings : []
          };
          
          setReport(safeReport);
          saveToHistory(file.name, safeReport);
        } catch (parseError) {
          console.error("Raw AI Response:", response.text);
          throw new Error('AI 返回的数据格式不正确，无法解析报告。请重试。');
        }
      } else {
        throw new Error('AI 未能生成审核报告。');
      }
    } catch (err: any) {
      console.error("Full error object:", err);
      const errorMessage = String(err?.message || err);
      
      if (errorMessage.includes('429') || errorMessage.includes('Quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        setError('分析失败：您今天使用的 AI 额度已耗尽 (Quota Exceeded)。因为使用的是免费的 API 密钥，每天有调用次数限制。请明天再试，或者更换一个新的 API 密钥。');
      } else {
        setError(errorMessage || '分析视频时发生错误，请重试。');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Approved': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'Rejected': return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'Needs Review': return 'bg-amber-100 text-amber-800 border-amber-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'Approved': return '审核通过';
      case 'Rejected': return '违规拒绝';
      case 'Needs Review': return '需人工复核';
      default: return status;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'High': return 'text-rose-600 bg-rose-50';
      case 'Medium': return 'text-amber-600 bg-amber-50';
      case 'Low': return 'text-blue-600 bg-blue-50';
      default: return 'text-slate-600 bg-slate-50';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">AI 视频智能审核系统</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:flex text-sm text-slate-500 items-center gap-1">
              <Info className="w-4 h-4" />
              <span>基于 Gemini 3.1 Pro 多模态大模型</span>
            </div>
            <button 
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors bg-slate-100 hover:bg-blue-50 px-3 py-1.5 rounded-full"
            >
              <Clock className="w-4 h-4" />
              历史记录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input & Configuration */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Upload Section */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                <h2 className="font-medium flex items-center gap-2">
                  <Video className="w-4 h-4 text-blue-600" />
                  1. 上传待审视频
                </h2>
              </div>
              <div className="p-5">
                {!previewUrl ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 hover:border-blue-400 transition-colors cursor-pointer group"
                  >
                    <div className="bg-blue-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-blue-600" />
                    </div>
                    <p className="font-medium text-slate-700 mb-1">点击上传视频文件</p>
                    <p className="text-xs text-slate-500">支持 MP4, WebM (建议 &lt; 20MB, 最大 50MB)</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
                      <video 
                        src={previewUrl} 
                        controls 
                        className="max-h-full w-full"
                      />
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500 truncate max-w-[200px]">{file?.name}</span>
                      <button 
                        onClick={() => {
                          setFile(null);
                          setPreviewUrl(null);
                          setReport(null);
                          setWarning(null);
                        }}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                      >
                        重新上传
                      </button>
                    </div>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="video/*" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </div>
            </section>

            {/* Criteria Section */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h2 className="font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  2. 设置审核标准
                </h2>
              </div>
              <div className="p-5">
                <div className="mb-4 flex flex-wrap gap-2">
                  {templates.map((tpl, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCriteria(tpl.text)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                        criteria === tpl.text 
                          ? "bg-blue-50 border-blue-200 text-blue-700" 
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-slate-500 mb-3">
                  你可以直接使用上方的快捷模板，也可以在下方自由修改审核规则：
                </p>
                <textarea
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  className="w-full h-40 p-3 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none transition-shadow leading-relaxed"
                  placeholder="请输入审核规则..."
                />
              </div>
            </section>

            {/* Action Button */}
            <button
              onClick={handleAnalyze}
              disabled={!file || isAnalyzing || !criteria.trim()}
              className={cn(
                "w-full py-4 rounded-xl font-medium text-white shadow-sm flex items-center justify-center gap-2 transition-all",
                (!file || isAnalyzing || !criteria.trim()) 
                  ? "bg-slate-300 cursor-not-allowed" 
                  : "bg-blue-600 hover:bg-blue-700 hover:shadow-md active:scale-[0.98]"
              )}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  AI 正在逐帧分析中...
                </>
              ) : (
                <>
                  <ShieldAlert className="w-5 h-5" />
                  开始智能审核
                </>
              )}
            </button>

            {warning && !error && !isAnalyzing && (
              <div className="p-4 bg-amber-50 text-amber-700 rounded-xl border border-amber-200 text-sm flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{warning}</p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 h-full min-h-[600px] flex flex-col overflow-hidden">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h2 className="font-medium flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  审核分析报告
                </h2>
                {report && (
                  <span className="text-xs font-medium text-slate-400">
                    AI 置信度: {report.confidence}%
                  </span>
                )}
              </div>
              
              <div className="p-6 flex-1 overflow-y-auto bg-slate-50/30">
                {!report && !isAnalyzing && !error && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                      <ShieldAlert className="w-8 h-8 text-slate-300" />
                    </div>
                    <p>上传视频并点击开始，获取 AI 审核报告</p>
                  </div>
                )}

                {error && !isAnalyzing && !report && (
                  <div className="h-full flex flex-col items-center justify-center text-rose-500 space-y-4 p-6 text-center">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center">
                      <AlertTriangle className="w-8 h-8 text-rose-400" />
                    </div>
                    <p className="font-medium">分析失败</p>
                    <p className="text-sm text-rose-400 max-w-md">{error}</p>
                    <p className="text-xs text-slate-500 mt-4">
                      可能原因：视频过大导致请求超时，或 AI 返回了无法识别的格式。建议尝试更短的视频片段。
                    </p>
                  </div>
                )}

                {isAnalyzing && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-6">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-blue-100 rounded-full"></div>
                      <div className="w-16 h-16 border-4 border-blue-600 rounded-full border-t-transparent animate-spin absolute top-0 left-0"></div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="font-medium text-slate-700">正在进行多模态分析</p>
                      <p className="text-sm">提取视频帧、分析音频轨道、比对审核规则...</p>
                    </div>
                  </div>
                )}

                {report && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Status Overview */}
                    <div className="flex items-start gap-6">
                      <div className={cn(
                        "px-4 py-2 rounded-full border font-semibold text-sm tracking-wide",
                        getStatusColor(report.status)
                      )}>
                        {getStatusText(report.status)}
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">综合摘要</h3>
                      <p className="text-slate-700 leading-relaxed text-sm">
                        {report.summary}
                      </p>
                    </div>

                    {/* Timeline / Findings */}
                    <div>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">发现的问题点 ({(report.findings || []).length})</h3>
                      
                      {(report.findings || []).length === 0 ? (
                        <div className="text-center py-8 bg-white rounded-xl border border-slate-200 border-dashed">
                          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">未发现任何违规或异常内容</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {(report.findings || []).map((finding, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-4 relative overflow-hidden">
                              {/* Left decorative line */}
                              <div className={cn(
                                "absolute left-0 top-0 bottom-0 w-1",
                                finding.severity === 'High' ? 'bg-rose-500' : 
                                finding.severity === 'Medium' ? 'bg-amber-500' : 'bg-blue-500'
                              )} />
                              
                              <div className="shrink-0 pt-1 pl-2">
                                <div className="bg-slate-100 text-slate-600 text-xs font-mono px-2 py-1 rounded">
                                  {finding.timestamp}
                                </div>
                              </div>
                              
                              <div className="flex-1 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium text-slate-900 leading-snug">
                                    {finding.issue}
                                  </p>
                                  <span className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0",
                                    getSeverityColor(finding.severity)
                                  )}>
                                    {finding.severity}
                                  </span>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-lg text-xs text-slate-600 flex gap-2 items-start">
                                  <AlertTriangle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                  <p><span className="font-medium text-slate-700">处理建议：</span>{finding.recommendation}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* History Slide-over Panel */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="font-semibold flex items-center gap-2 text-slate-800">
                <Clock className="w-4 h-4 text-blue-600"/> 
                审核历史记录
              </h2>
              <button 
                onClick={() => setShowHistory(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4"/>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-center text-slate-400 mt-20 space-y-2">
                  <Clock className="w-12 h-12 mx-auto opacity-20" />
                  <p>暂无历史记录</p>
                  <p className="text-xs">审核过的视频报告会保存在这里</p>
                </div>
              ) : (
                history.map(item => (
                  <div 
                    key={item.id} 
                    className="border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all bg-white group" 
                    onClick={() => loadHistoryItem(item)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs text-slate-400 font-mono">{item.date}</span>
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider", 
                        getStatusColor(item.report.status)
                      )}>
                        {getStatusText(item.report.status)}
                      </span>
                    </div>
                    <p className="font-medium text-sm text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                      {item.fileName}
                    </p>
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                      {item.report.summary}
                    </p>
                  </div>
                ))
              )}
            </div>

            {history.length > 0 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <button 
                  onClick={clearHistory} 
                  className="w-full py-2.5 flex items-center justify-center gap-2 text-sm font-medium text-rose-600 hover:bg-rose-100 rounded-xl transition-colors"
                >
                  <Trash2 className="w-4 h-4"/> 
                  清空所有记录
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
