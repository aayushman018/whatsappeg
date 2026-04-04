import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Send,
  Settings,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

interface Message {
  id: string;
  from: string;
  to?: string;
  text: string;
  timestamp: string;
  type: 'incoming' | 'outgoing';
  contact_name?: string;
  ai_response?: {
    reply_to_user: string;
    is_important: boolean;
    importance_reason: string;
    summary: string;
  };
}

interface AppSettings {
  system_prompt: string;
}

interface Conversation {
  phone: string;
  displayName: string;
  messages: Message[];
  lastTimestamp: string;
  importantCount: number;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    system_prompt: '',
  });
  const [activeTab, setActiveTab] = useState<'messages' | 'settings' | 'alerts'>('messages');
  const [selectedConversationPhone, setSelectedConversationPhone] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const resp = await fetch('/auth/me', { method: 'GET' });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as { authenticated: boolean; email?: string };
        setIsAuthenticated(Boolean(data.authenticated));
        setSessionEmail(data.email ?? null);
      } catch (error) {
        console.error('Failed auth check', error);
        setIsAuthenticated(false);
        setSessionEmail(null);
      } finally {
        setAuthChecked(true);
      }
    };

    void checkAuth();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    const fetchMessages = async () => {
      try {
        const resp = await fetch('/api/messages?limit=200');
        if (!resp.ok) {
          if (resp.status === 401) {
            setIsAuthenticated(false);
            setSessionEmail(null);
            return;
          }
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
          if (resp.status === 401) {
            setIsAuthenticated(false);
            setSessionEmail(null);
            return;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as AppSettings;
        if (!cancelled) {
          setSettings({ system_prompt: data.system_prompt ?? '' });
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
  }, [isAuthenticated]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      const payload = (await resp.json()) as { ok?: boolean; error?: string; email?: string };
      if (!resp.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${resp.status}`);
      }

      setIsAuthenticated(true);
      setSessionEmail(payload.email ?? loginEmail);
      setLoginPassword('');
      setLoginError(null);
    } catch (error) {
      console.error('Login failed', error);
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout failed', error);
    }
    setIsAuthenticated(false);
    setSessionEmail(null);
    setMessages([]);
  };

  const saveSettings = async () => {
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_prompt: settings.system_prompt,
        }),
      });

      if (!resp.ok) {
        if (resp.status === 401) {
          setIsAuthenticated(false);
          setSessionEmail(null);
          return;
        }
        throw new Error(`HTTP ${resp.status}`);
      }

      alert('Prompt saved successfully!');
      setApiError(null);
    } catch (error) {
      console.error('Failed to save settings', error);
      setApiError('Failed to save prompt to server.');
      alert('Failed to save prompt. Check console for details.');
    }
  };

  const conversations = useMemo<Conversation[]>(() => {
    const grouped = new Map<string, Message[]>();

    for (const message of messages) {
      const phone = message.from || message.to || 'Unknown';
      if (!grouped.has(phone)) {
        grouped.set(phone, []);
      }
      grouped.get(phone)!.push(message);
    }

    return Array.from(grouped.entries())
      .map(([phone, groupedMessages]) => {
        const sortedAsc = [...groupedMessages].sort(
          (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
        );
        const latest = sortedAsc[sortedAsc.length - 1];
        const displayName =
          latest?.contact_name && latest.contact_name.trim().length > 0
            ? latest.contact_name.trim()
            : phone;

        return {
          phone,
          displayName,
          messages: sortedAsc,
          lastTimestamp: latest?.timestamp ?? new Date(0).toISOString(),
          importantCount: sortedAsc.filter((m) => m.ai_response?.is_important).length,
        };
      })
      .sort((a, b) => Date.parse(b.lastTimestamp) - Date.parse(a.lastTimestamp));
  }, [messages]);

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedConversationPhone(null);
      return;
    }

    const hasSelected = conversations.some(
      (conversation) => conversation.phone === selectedConversationPhone
    );
    if (!hasSelected) {
      setSelectedConversationPhone(conversations[0].phone);
    }
  }, [conversations, selectedConversationPhone]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.phone === selectedConversationPhone) ??
      null,
    [conversations, selectedConversationPhone]
  );

  const alerts = messages.filter((m) => m.ai_response?.is_important);

  const tabs = [
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'alerts', label: 'Priority Alerts', icon: AlertCircle, count: alerts.length },
    { id: 'settings', label: 'AI Prompt', icon: Settings },
  ] as const;

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? activeTab;

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.form
          onSubmit={handleLogin}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8"
        >
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2 text-center">Admin Login</h1>
          <p className="text-slate-500 mb-8 text-center">Sign in to access WhatsApp Intelligence.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Email</label>
              <input
                type="text"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="Your secure password"
                required
              />
            </div>
          </div>

          {loginError && <p className="text-sm text-rose-600 mt-4">{loginError}</p>}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
          >
            {isLoggingIn ? 'Signing in...' : 'Sign in'}
          </button>
        </motion.form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0',
          !isSidebarOpen && '-translate-x-full'
        )}
      >
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
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all',
                  activeTab === item.id
                    ? 'bg-emerald-50 text-emerald-700 font-medium'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                )}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </div>
                {'count' in item && item.count ? (
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
                <p className="text-sm font-medium text-slate-900 truncate">{sessionEmail || 'Admin'}</p>
                <p className="text-xs text-slate-500 truncate">Authenticated session</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2 text-slate-500 hover:text-rose-600 transition-colors"
            >
              <LogOut size={18} />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-500">
              <Menu size={24} />
            </button>
            <h2 className="text-lg font-semibold text-slate-900">{activeTabLabel}</h2>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Clock size={14} />
            <span>Last updated: {new Date().toLocaleTimeString()}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {apiError && (
            <div className="max-w-6xl mx-auto mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
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
                className="max-w-6xl mx-auto"
              >
                {conversations.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageSquare size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">No messages yet</h3>
                    <p className="text-slate-500">Incoming WhatsApp messages will appear here.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
                    <aside className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-sm font-bold text-slate-900">Conversations</p>
                      </div>
                      <div className="max-h-[70vh] overflow-y-auto p-2 space-y-2">
                        {conversations.map((conversation) => {
                          const latest = conversation.messages[conversation.messages.length - 1];
                          const latestText = latest?.text ?? '';
                          return (
                            <button
                              key={conversation.phone}
                              onClick={() => setSelectedConversationPhone(conversation.phone)}
                              className={cn(
                                'w-full text-left rounded-xl p-3 border transition-all',
                                conversation.phone === selectedConversationPhone
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-transparent hover:bg-slate-50'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-bold text-slate-900 truncate">
                                  {conversation.displayName}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {new Date(conversation.lastTimestamp).toLocaleTimeString()}
                                </p>
                              </div>
                              <p className="text-xs text-slate-500 truncate">{conversation.phone}</p>
                              <p className="text-xs text-slate-500 mt-1 truncate">{latestText}</p>
                              {conversation.importantCount > 0 && (
                                <span className="inline-flex mt-2 bg-rose-100 text-rose-600 text-[10px] font-bold px-2 py-1 rounded-full">
                                  {conversation.importantCount} priority
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      {selectedConversation ? (
                        <>
                          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                            <p className="text-base font-bold text-slate-900">
                              {selectedConversation.displayName}
                            </p>
                            <p className="text-sm text-slate-500">{selectedConversation.phone}</p>
                          </div>

                          <div className="max-h-[70vh] overflow-y-auto">
                            {selectedConversation.messages.map((msg) => (
                              <div key={msg.id} className="border-b border-slate-100 last:border-b-0">
                                <div className="p-4">
                                  <div className="text-xs text-slate-400 mb-3">
                                    {new Date(msg.timestamp).toLocaleString()}
                                  </div>

                                  {msg.type === 'incoming' ? (
                                    <div className="flex gap-3">
                                      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                                        <User size={16} className="text-slate-500" />
                                      </div>
                                      <div className="bg-slate-100 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700 max-w-[80%]">
                                        {msg.text}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex gap-3 justify-end">
                                      <div className="flex flex-col items-end gap-2 max-w-[80%]">
                                        <div className="bg-emerald-600 text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
                                          {msg.text}
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                                          <CheckCircle2 size={10} className="text-emerald-500" />
                                          AI Outgoing Message
                                        </div>
                                      </div>
                                      <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                                        <MessageSquare size={16} className="text-emerald-600" />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {msg.type === 'incoming' && msg.ai_response && (
                                  <div className="p-4 bg-slate-50 border-t border-slate-100">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                          Summary
                                        </p>
                                        <p className="text-xs text-slate-600 leading-relaxed">
                                          {msg.ai_response.summary}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                          AI Reasoning
                                        </p>
                                        <p className="text-xs text-slate-600 leading-relaxed">
                                          {msg.ai_response.importance_reason}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="p-12 text-center text-slate-500">
                          Select a conversation to view the full thread.
                        </div>
                      )}
                    </section>
                  </div>
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
                    <div
                      key={msg.id}
                      className="bg-white rounded-2xl shadow-sm border-l-4 border-l-rose-500 border border-slate-200 p-6"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-slate-900">{msg.contact_name || msg.from}</h3>
                          <p className="text-xs text-slate-500">{msg.from}</p>
                          <p className="text-xs text-slate-400">{new Date(msg.timestamp).toLocaleString()}</p>
                        </div>
                        <span className="text-xs font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">
                          {msg.ai_response?.importance_reason}
                        </span>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 mb-4">
                        <p className="text-sm text-slate-400 font-bold uppercase text-[10px] mb-1">
                          Original Text
                        </p>
                        <p className="text-sm text-slate-700 italic">"{msg.text}"</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900">{msg.ai_response?.summary}</p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedConversationPhone(msg.from);
                            setActiveTab('messages');
                          }}
                          className="flex items-center gap-2 text-emerald-600 font-bold text-sm hover:underline"
                        >
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
                    <h3 className="text-lg font-bold text-slate-900 mb-1">AI Prompt</h3>
                    <p className="text-sm text-slate-500">
                      Edit only the prompt here. API tokens and IDs are managed in backend environment variables.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">System Prompt</label>
                    <textarea
                      value={settings.system_prompt}
                      onChange={(e) => setSettings({ ...settings, system_prompt: e.target.value })}
                      className="w-full h-48 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                      placeholder="You are a professional customer support assistant..."
                    />
                  </div>

                  <button
                    onClick={saveSettings}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-200"
                  >
                    Save Prompt
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
