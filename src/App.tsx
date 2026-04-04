import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from './lib/utils';

interface Message {
  id: string;
  from: string;
  to?: string;
  text: string;
  timestamp: string;
  type: 'incoming' | 'outgoing';
  contact_name?: string;
  is_priority?: boolean;
  priority_reasons?: string[];
  reply_source?: 'ai' | 'manual';
  ai_response?: {
    reply_to_user: string;
    is_important: boolean;
    importance_reason: string;
    summary: string;
    lead_score: number;
  };
}

interface Contact {
  phone: string;
  ai_enabled: boolean;
  label: string;
  name: string;
  last_timestamp: string | null;
  message_count: number;
}

interface AnalyticsData {
  ai_response_rate: number;
  incoming_total: number;
  outgoing_total: number;
  daily_totals: Array<{ date: string; count: number }>;
  weekly_totals: Array<{ week: string; count: number }>;
  most_active_contacts: Array<{
    phone: string;
    name: string;
    label: string;
    count: number;
    ai_enabled: boolean;
  }>;
  peak_hours_utc: Array<{ hour: number; count: number }>;
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
  priorityCount: number;
  label: string;
  aiEnabled: boolean;
}

const DEFAULT_LABELS = ['', 'Lead', 'Customer', 'Spam', 'School'];

function normalizePhone(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ system_prompt: '' });
  const [activeTab, setActiveTab] = useState<'messages' | 'alerts' | 'analytics' | 'settings'>(
    'messages'
  );
  const [selectedConversationPhone, setSelectedConversationPhone] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [manualReplyText, setManualReplyText] = useState('');
  const [isSendingManualReply, setIsSendingManualReply] = useState(false);
  const [isUpdatingContact, setIsUpdatingContact] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterPhone, setFilterPhone] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [labelFilter, setLabelFilter] = useState('');

  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const contactMap = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) {
      map.set(normalizePhone(contact.phone), contact);
    }
    return map;
  }, [contacts]);

  const labelOptions = useMemo(() => {
    const fromContacts = contacts
      .map((contact) => contact.label.trim())
      .filter((label) => label.length > 0);
    return Array.from(new Set([...DEFAULT_LABELS, ...fromContacts]));
  }, [contacts]);

  const fetchWithAuthHandling = async <T,>(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<T> => {
    const resp = await fetch(input, init);
    if (resp.status === 401) {
      setIsAuthenticated(false);
      setSessionEmail(null);
      throw new Error('Unauthorized');
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return (await resp.json()) as T;
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const data = await fetchWithAuthHandling<{ authenticated: boolean; email?: string }>(
          '/auth/me'
        );
        setIsAuthenticated(Boolean(data.authenticated));
        setSessionEmail(data.email ?? null);
      } catch {
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
      setContacts([]);
      setAnalytics(null);
      return;
    }

    let cancelled = false;

    const buildMessagesUrl = () => {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      if (filterPhone.trim()) {
        params.set('phone', filterPhone.trim());
      }
      if (dateFrom) {
        params.set('dateFrom', dateFrom);
      }
      if (dateTo) {
        params.set('dateTo', dateTo);
      }
      if (labelFilter) {
        params.set('label', labelFilter);
      }
      return `/api/messages?${params.toString()}`;
    };

    const fetchMessages = async () => {
      try {
        const data = await fetchWithAuthHandling<Message[]>(buildMessagesUrl());
        if (!cancelled) {
          setMessages(data);
          setApiError(null);
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && error.message !== 'Unauthorized') {
          setApiError('Failed to load messages.');
        }
      }
    };

    const fetchContacts = async () => {
      try {
        const data = await fetchWithAuthHandling<Contact[]>('/api/contacts');
        if (!cancelled) {
          setContacts(data);
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && error.message !== 'Unauthorized') {
          setApiError('Failed to load contacts.');
        }
      }
    };

    const fetchSettings = async () => {
      try {
        const data = await fetchWithAuthHandling<AppSettings>('/api/settings');
        if (!cancelled) {
          setSettings({ system_prompt: data.system_prompt ?? '' });
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && error.message !== 'Unauthorized') {
          setApiError('Failed to load prompt settings.');
        }
      }
    };

    const fetchAnalytics = async () => {
      try {
        const data = await fetchWithAuthHandling<AnalyticsData>('/api/analytics');
        if (!cancelled) {
          setAnalytics(data);
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && error.message !== 'Unauthorized') {
          setApiError('Failed to load analytics.');
        }
      }
    };

    void fetchMessages();
    void fetchContacts();
    void fetchSettings();
    void fetchAnalytics();

    const msgPoll = window.setInterval(() => void fetchMessages(), 5000);
    const contactsPoll = window.setInterval(() => void fetchContacts(), 15000);
    const analyticsPoll = window.setInterval(() => void fetchAnalytics(), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(msgPoll);
      window.clearInterval(contactsPoll);
      window.clearInterval(analyticsPoll);
    };
  }, [isAuthenticated, searchQuery, filterPhone, dateFrom, dateTo, labelFilter]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const payload = await fetchWithAuthHandling<{ ok?: boolean; email?: string; error?: string }>(
        '/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: loginEmail, password: loginPassword }),
        }
      );
      if (!payload.ok) {
        throw new Error(payload.error || 'Login failed');
      }
      setIsAuthenticated(true);
      setSessionEmail(payload.email ?? loginEmail);
      setLoginPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch {
      // no-op
    }
    setIsAuthenticated(false);
    setSessionEmail(null);
  };

  const saveSettings = async () => {
    try {
      await fetchWithAuthHandling<{ ok: boolean }>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: settings.system_prompt }),
      });
      setApiError(null);
      alert('Prompt saved.');
    } catch {
      setApiError('Failed to save prompt.');
    }
  };

  const updateContact = async (phone: string, patch: Partial<Contact>) => {
    setIsUpdatingContact(true);
    try {
      await fetchWithAuthHandling('/api/contacts/' + encodeURIComponent(phone), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const updated = await fetchWithAuthHandling<Contact[]>('/api/contacts');
      setContacts(updated);
    } catch {
      setApiError('Failed to update contact settings.');
    } finally {
      setIsUpdatingContact(false);
    }
  };

  const sendManualReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedConversationPhone || !manualReplyText.trim()) {
      return;
    }
    setIsSendingManualReply(true);
    try {
      await fetchWithAuthHandling('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedConversationPhone, text: manualReplyText.trim() }),
      });
      setManualReplyText('');
    } catch {
      setApiError('Failed to send manual reply.');
    } finally {
      setIsSendingManualReply(false);
    }
  };

  const conversations = useMemo<Conversation[]>(() => {
    const grouped = new Map<string, Message[]>();
    for (const message of messages) {
      const phone = normalizePhone(message.from || message.to || 'Unknown');
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
        const contact = contactMap.get(phone);
        return {
          phone,
          displayName: latest?.contact_name?.trim() || contact?.name?.trim() || phone,
          messages: sortedAsc,
          lastTimestamp: latest?.timestamp ?? new Date(0).toISOString(),
          importantCount: sortedAsc.filter((message) => message.ai_response?.is_important).length,
          priorityCount: sortedAsc.filter((message) => message.is_priority).length,
          label: contact?.label ?? '',
          aiEnabled: contact?.ai_enabled ?? true,
        };
      })
      .sort((a, b) => Date.parse(b.lastTimestamp) - Date.parse(a.lastTimestamp));
  }, [messages, contactMap]);

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedConversationPhone(null);
      return;
    }
    const exists = conversations.some((conversation) => conversation.phone === selectedConversationPhone);
    if (!exists) {
      setSelectedConversationPhone(conversations[0].phone);
    }
  }, [conversations, selectedConversationPhone]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.phone === selectedConversationPhone) ?? null,
    [conversations, selectedConversationPhone]
  );

  const alerts = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.type === 'incoming' && (message.is_priority || message.ai_response?.is_important)
      ),
    [messages]
  );

  const tabs = [
    { id: 'messages', label: 'Messages', icon: MessageSquare },
    { id: 'alerts', label: 'Priority Alerts', icon: AlertCircle, count: alerts.length },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'AI Prompt', icon: Settings },
  ] as const;

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
            <h2 className="text-lg font-semibold text-slate-900">
              {tabs.find((tab) => tab.id === activeTab)?.label ?? activeTab}
            </h2>
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
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="max-w-7xl mx-auto space-y-4"
              >
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    <div className="relative xl:col-span-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search keyword, number, or summary"
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                      />
                    </div>
                    <input
                      value={filterPhone}
                      onChange={(e) => setFilterPhone(e.target.value)}
                      placeholder="Phone filter"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                    />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                    />
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                      />
                      <select
                        value={labelFilter}
                        onChange={(e) => setLabelFilter(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-slate-50"
                      >
                        {labelOptions.map((label) => (
                          <option key={label || 'all'} value={label}>
                            {label || 'All labels'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {conversations.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MessageSquare size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">No messages found</h3>
                    <p className="text-slate-500">Try changing filters or wait for new inbound messages.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
                    <aside className="bg-white rounded-2xl border border-slate-200 overflow-hidden h-fit">
                      <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold">Conversations</div>
                      <div className="max-h-[72vh] overflow-y-auto p-2 space-y-2">
                        {conversations.map((conversation) => {
                          const latest = conversation.messages[conversation.messages.length - 1];
                          return (
                            <button
                              key={conversation.phone}
                              onClick={() => setSelectedConversationPhone(conversation.phone)}
                              className={cn(
                                'w-full text-left rounded-xl p-3 border transition-all',
                                selectedConversationPhone === conversation.phone
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-transparent hover:bg-slate-50'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-bold text-slate-900 truncate">{conversation.displayName}</p>
                                <p className="text-[10px] text-slate-400">
                                  {new Date(conversation.lastTimestamp).toLocaleTimeString()}
                                </p>
                              </div>
                              <p className="text-xs text-slate-500 truncate">{conversation.phone}</p>
                              <p className="text-xs text-slate-500 mt-1 truncate">{latest?.text || ''}</p>
                              <div className="flex gap-2 mt-2">
                                {conversation.label && (
                                  <span className="text-[10px] px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">
                                    {conversation.label}
                                  </span>
                                )}
                                {!conversation.aiEnabled && (
                                  <span className="text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                                    AI Off
                                  </span>
                                )}
                                {conversation.priorityCount > 0 && (
                                  <span className="text-[10px] px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                                    {conversation.priorityCount} priority
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                      {!selectedConversation ? (
                        <div className="p-12 text-center text-slate-500">
                          Select a conversation to view the thread.
                        </div>
                      ) : (
                        <div className="flex flex-col h-[72vh]">
                          <div className="p-4 border-b border-slate-100 space-y-3">
                            <div>
                              <p className="text-base font-bold text-slate-900">{selectedConversation.displayName}</p>
                              <p className="text-sm text-slate-500">{selectedConversation.phone}</p>
                            </div>
                            <div className="flex flex-wrap gap-3 items-center">
                              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={selectedConversation.aiEnabled}
                                  disabled={isUpdatingContact}
                                  onChange={(e) =>
                                    void updateContact(selectedConversation.phone, {
                                      ai_enabled: e.target.checked,
                                    })
                                  }
                                />
                                AI auto-reply
                              </label>
                              <select
                                value={selectedConversation.label}
                                disabled={isUpdatingContact}
                                onChange={(e) =>
                                  void updateContact(selectedConversation.phone, { label: e.target.value })
                                }
                                className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-slate-50"
                              >
                                {labelOptions.map((label) => (
                                  <option key={label || 'none'} value={label}>
                                    {label || 'No label'}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto">
                            {selectedConversation.messages.map((message) => (
                              <div key={message.id} className="border-b border-slate-100 p-4">
                                <div className="text-xs text-slate-400 mb-3">{formatDateTime(message.timestamp)}</div>
                                {message.type === 'incoming' ? (
                                  <div className="space-y-2">
                                    <div className="flex gap-3">
                                      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
                                        <User size={16} className="text-slate-500" />
                                      </div>
                                      <div className="bg-slate-100 rounded-2xl rounded-tl-none p-3 text-sm text-slate-700 max-w-[85%]">
                                        {message.text}
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 ml-11">
                                      {message.is_priority && (
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-rose-100 text-rose-700">
                                          Priority
                                        </span>
                                      )}
                                      {message.ai_response?.lead_score ? (
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                                          Lead score: {message.ai_response.lead_score}/10
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-3">
                                    <div className="flex flex-col items-end max-w-[85%]">
                                      <div className="bg-emerald-600 text-white rounded-2xl rounded-tr-none p-3 text-sm">
                                        {message.text}
                                      </div>
                                      <div className="text-[10px] text-slate-400 mt-1">
                                        {message.reply_source === 'manual' ? 'Manual reply' : 'AI reply'}
                                      </div>
                                    </div>
                                    <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                                      <MessageSquare size={16} className="text-emerald-600" />
                                    </div>
                                  </div>
                                )}
                                {message.type === 'incoming' && message.ai_response && (
                                  <div className="ml-11 mt-3 bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs text-slate-600 space-y-1">
                                    <p>
                                      <span className="font-bold text-slate-500">Summary:</span>{' '}
                                      {message.ai_response.summary}
                                    </p>
                                    <p>
                                      <span className="font-bold text-slate-500">Reason:</span>{' '}
                                      {message.ai_response.importance_reason}
                                    </p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <form onSubmit={sendManualReply} className="border-t border-slate-100 p-4 bg-slate-50">
                            <div className="flex gap-2">
                              <input
                                value={manualReplyText}
                                onChange={(e) => setManualReplyText(e.target.value)}
                                placeholder="Type manual reply to override AI..."
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                              />
                              <button
                                type="submit"
                                disabled={isSendingManualReply || !manualReplyText.trim()}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-60"
                              >
                                {isSendingManualReply ? 'Sending...' : 'Send'}
                              </button>
                            </div>
                          </form>
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
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-4 max-w-5xl mx-auto"
              >
                {alerts.length === 0 ? (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900">No active alerts</h3>
                    <p className="text-slate-500">Priority and important messages will appear here.</p>
                  </div>
                ) : (
                  alerts.map((message) => (
                    <div
                      key={message.id}
                      className="bg-white rounded-2xl border border-slate-200 border-l-4 border-l-rose-500 p-5"
                    >
                      <div className="flex justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-slate-900">{message.contact_name || message.from}</h3>
                          <p className="text-xs text-slate-500">{message.from}</p>
                          <p className="text-xs text-slate-400">{formatDateTime(message.timestamp)}</p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedConversationPhone(normalizePhone(message.from));
                            setActiveTab('messages');
                          }}
                          className="text-sm font-semibold text-emerald-600"
                        >
                          Open thread
                        </button>
                      </div>
                      <p className="mt-3 text-sm text-slate-700">{message.text}</p>
                      <p className="mt-2 text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-lg inline-block">
                        {(message.priority_reasons && message.priority_reasons.length > 0
                          ? message.priority_reasons.join(', ')
                          : message.ai_response?.importance_reason) || 'Priority signal'}
                      </p>
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'analytics' && (
              <motion.div
                key="analytics"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="max-w-6xl mx-auto space-y-4"
              >
                {!analytics ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-8 text-slate-500">
                    Loading analytics...
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-xs text-slate-500">Incoming</p>
                        <p className="text-2xl font-bold text-slate-900">{analytics.incoming_total}</p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-xs text-slate-500">Outgoing</p>
                        <p className="text-2xl font-bold text-slate-900">{analytics.outgoing_total}</p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-xs text-slate-500">AI Response Rate</p>
                        <p className="text-2xl font-bold text-slate-900">
                          {(analytics.ai_response_rate * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <p className="text-xs text-slate-500">Tracked Contacts</p>
                        <p className="text-2xl font-bold text-slate-900">{contacts.length}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <h3 className="text-sm font-bold text-slate-900 mb-3">Messages Per Day</h3>
                        <div className="space-y-2">
                          {analytics.daily_totals.slice(-7).map((item) => (
                            <div key={item.date} className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">{item.date}</span>
                              <span className="font-semibold text-slate-900">{item.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <h3 className="text-sm font-bold text-slate-900 mb-3">Messages Per Week</h3>
                        <div className="space-y-2">
                          {analytics.weekly_totals.slice(-8).map((item) => (
                            <div key={item.week} className="flex items-center justify-between text-sm">
                              <span className="text-slate-600">{item.week}</span>
                              <span className="font-semibold text-slate-900">{item.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <h3 className="text-sm font-bold text-slate-900 mb-3">Most Active Contacts</h3>
                        <div className="space-y-2">
                          {analytics.most_active_contacts.map((contact) => (
                            <div key={contact.phone} className="flex justify-between items-center text-sm">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 truncate">{contact.name}</p>
                                <p className="text-xs text-slate-500 truncate">{contact.phone}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-slate-900">{contact.count}</p>
                                {contact.label && <p className="text-xs text-indigo-600">{contact.label}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl p-4">
                        <h3 className="text-sm font-bold text-slate-900 mb-3">Peak Hours (UTC)</h3>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {analytics.peak_hours_utc.map((slot) => (
                            <div key={slot.hour} className="bg-slate-50 rounded-lg p-2 text-center">
                              <p className="text-slate-500">{String(slot.hour).padStart(2, '0')}:00</p>
                              <p className="font-bold text-slate-900">{slot.count}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-white rounded-2xl border border-slate-200 p-8 space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 mb-1">AI Prompt</h3>
                    <p className="text-sm text-slate-500">
                      Change only the prompt here. API keys and WhatsApp credentials stay on backend.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">System Prompt</label>
                    <textarea
                      value={settings.system_prompt}
                      onChange={(e) => setSettings({ ...settings, system_prompt: e.target.value })}
                      className="w-full h-52 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <button
                    onClick={saveSettings}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl"
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
