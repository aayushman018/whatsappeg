import { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Settings, 
  AlertCircle, 
  Send, 
  User, 
  CheckCircle2, 
  Clock,
  ShieldAlert,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

interface Message {
  id: string;
  from: string;
  text: string;
  timestamp: string;
  type: 'incoming' | 'outgoing';
  ai_response?: {
    reply_to_user: string;
    is_important: boolean;
    importance_reason: string;
    summary: string;
  };
}

interface AppSettings {
  system_prompt: string;
  whatsapp_token: string;
  phone_id: string;
  whatsapp_business_id: string;
  personal_phone: string;
  verify_token: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    system_prompt: '',
    whatsapp_token: '',
    phone_id: '',
    whatsapp_business_id: '',
    personal_phone: '',
    verify_token: 'my_secret_token'
  });
  const [activeTab, setActiveTab] = useState<'messages' | 'settings' | 'alerts'>('messages');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchMessages = async () => {
      try {
        const resp = await fetch('/api/messages?limit=50');
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as Message[];
        if (!cancelled) {
          setMessages(data);
          setApiError(null);
        }
      } catch (error) {
        console.error('Failed to read messages', error);
        if (!cancelled) {
          setApiError('Failed to load messages from server.');
        }
      }
    };

    const fetchSettings = async () => {
      try {
        const resp = await fetch('/api/settings');
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as AppSettings;
        if (!cancelled) {
          setSettings(data);
          setApiError(null);
        }
      } catch (error) {
        console.error('Failed to read settings', error);
        if (!cancelled) {
          setApiError('Failed to load settings from server.');
        }
      }
    };

    void fetchSettings();
    void fetchMessages();
    const pollId = window.setInterval(() => {
      void fetchMessages();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, []);

  const saveSettings = async () => {
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      alert("Settings saved successfully!");
      setApiError(null);
    } catch (error) {
      console.error("Failed to save settings", error);
      setApiError('Failed to save settings to server.');
      alert("Failed to save settings. Check console for details.");
    }
  };

  const alerts = messages.filter(m => m.ai_response?.is_important);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
        !isSidebarOpen && "-translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 font-bold text-xl">
              <MessageSquare size={24} />
              <span>WA Intel</span>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 px-4 space-y-2">
            {[
              { id: 'messages', label: 'Messages', icon: MessageSquare },
              { id: 'alerts', label: 'Priority Alerts', icon: AlertCircle, count: alerts.length },
              { id: 'settings', label: 'AI Settings', icon: Settings },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as any);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all",
                  activeTab === item.id 
                    ? "bg-emerald-50 text-emerald-700 font-medium" 
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                )}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </div>
                {item.count ? (
                  <span className="bg-rose-100 text-rose-600 text-xs font-bold px-2 py-1 rounded-full">
                    {item.count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-100">
            <div className="flex items-center gap-3 px-4 py-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <User size={14} className="text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">Admin Panel</p>
                <p className="text-xs text-slate-500 truncate">No login required</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-500">
              <Menu size={24} />
            </button>
            <h2 className="text-lg font-semibold text-slate-900 capitalize">{activeTab}</h2>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Clock size={14} />
            <span>Last updated: {new Date().toLocaleTimeString()}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {apiError && (
            <div className="max-w-4xl mx-auto mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
              {apiError}
            </div>
          )}
          <AnimatePresence mode="wait">
            {activeTab === 'messages' && (
              <motion.div 
                key="messages"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 max-w-4xl mx-auto"
              >
                {messages.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageSquare size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">No messages yet</h3>
                    <p className="text-slate-500">Incoming WhatsApp messages will appear here.</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-700">{msg.from}</span>
                          <span className="text-xs text-slate-400">•</span>
                          <span className="text-xs text-slate-400">{new Date(msg.timestamp).toLocaleString()}</span>
                        </div>
                        {msg.ai_response?.is_important && (
                          <span className="flex items-center gap-1 text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-md">
                            <ShieldAlert size={12} />
                            PRIORITY
                          </span>
                        )}
                      </div>
                      <div className="p-4 space-y-4">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                            <User size={16} className="text-slate-500" />
                          </div>
                          <div className="bg-slate-100 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700">
                            {msg.text}
                          </div>
                        </div>
                        {msg.ai_response && (
                          <div className="flex gap-3 justify-end">
                            <div className="flex flex-col items-end gap-2 max-w-[80%]">
                              <div className="bg-emerald-600 text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
                                {msg.ai_response.reply_to_user}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                                <CheckCircle2 size={10} className="text-emerald-500" />
                                AI Generated Response
                              </div>
                            </div>
                            <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                              <MessageSquare size={16} className="text-emerald-600" />
                            </div>
                          </div>
                        )}
                      </div>
                      {msg.ai_response && (
                        <div className="p-4 bg-slate-50 border-t border-slate-100">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Summary</p>
                              <p className="text-xs text-slate-600 leading-relaxed">{msg.ai_response.summary}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">AI Reasoning</p>
                              <p className="text-xs text-slate-600 leading-relaxed">{msg.ai_response.importance_reason}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'alerts' && (
              <motion.div 
                key="alerts"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4 max-w-4xl mx-auto"
              >
                {alerts.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">All caught up!</h3>
                    <p className="text-slate-500">No priority alerts at the moment.</p>
                  </div>
                ) : (
                  alerts.map((msg) => (
                    <div key={msg.id} className="bg-white rounded-2xl shadow-sm border-l-4 border-l-rose-500 border border-slate-200 p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-slate-900">{msg.from}</h3>
                          <p className="text-xs text-slate-400">{new Date(msg.timestamp).toLocaleString()}</p>
                        </div>
                        <span className="text-xs font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">
                          {msg.ai_response?.importance_reason}
                        </span>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 mb-4">
                        <p className="text-sm text-slate-400 font-bold uppercase text-[10px] mb-1">Original Text</p>
                        <p className="text-sm text-slate-700 italic">"{msg.text}"</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900">{msg.ai_response?.summary}</p>
                        </div>
                        <button className="flex items-center gap-2 text-emerald-600 font-bold text-sm hover:underline">
                          View Thread <Send size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 mb-1">AI Configuration</h3>
                    <p className="text-sm text-slate-500">Define how the AI should behave and respond to your customers.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">System Prompt</label>
                      <textarea 
                        value={settings.system_prompt}
                        onChange={(e) => setSettings({...settings, system_prompt: e.target.value})}
                        className="w-full h-40 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                        placeholder="You are a professional customer support assistant..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">WhatsApp Token</label>
                        <input 
                          type="password"
                          value={settings.whatsapp_token}
                          onChange={(e) => setSettings({...settings, whatsapp_token: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Phone ID</label>
                        <input 
                          type="text"
                          value={settings.phone_id}
                          onChange={(e) => setSettings({...settings, phone_id: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">WhatsApp Business ID</label>
                      <input 
                        type="text"
                        value={settings.whatsapp_business_id}
                        onChange={(e) => setSettings({...settings, whatsapp_business_id: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        placeholder="1430995588186077"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Personal Phone (for Alerts)</label>
                      <input 
                        type="text"
                        value={settings.personal_phone}
                        onChange={(e) => setSettings({...settings, personal_phone: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        placeholder="+1234567890"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Webhook Verify Token</label>
                      <input 
                        type="text"
                        value={settings.verify_token}
                        onChange={(e) => setSettings({...settings, verify_token: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        placeholder="my_secret_token"
                      />
                      <p className="text-[10px] text-slate-400 mt-1 italic">Default: my_secret_token</p>
                    </div>
                  </div>

                  <div className="pt-4 space-y-3">
                    <button 
                      onClick={saveSettings}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-200"
                    >
                      Save Configuration
                    </button>
                    <button 
                      onClick={async () => {
                        try {
                          const resp = await fetch(`/webhook?hub.mode=subscribe&hub.verify_token=${settings.verify_token}&hub.challenge=test_success`);
                          const text = await resp.text();
                          if (text === 'test_success') {
                            alert("✅ Webhook Test Successful! Your server is responding correctly.");
                          } else {
                            alert("❌ Webhook Test Failed: Server returned " + text);
                          }
                        } catch (e) {
                          alert("❌ Webhook Test Failed: Could not connect to server.");
                        }
                      }}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-all"
                    >
                      Test Webhook Connection
                    </button>
                  </div>
                </div>

                <div className="mt-8 bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                      <ShieldAlert size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-emerald-900 mb-1">Webhook Setup</h4>
                      <p className="text-sm text-emerald-700 leading-relaxed">
                        To receive messages, set your WhatsApp Webhook URL to:<br/>
                        <code className="bg-white/50 px-2 py-0.5 rounded font-mono text-xs break-all">
                          {window.location.origin}/webhook
                        </code>
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
