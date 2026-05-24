import React, { useEffect, useState } from 'react';
import { Plus, Workflow, Trash2, Edit2, Loader2, Zap } from 'lucide-react';

interface FlowNode {
  id: string;
  type: string;
  data: any;
  position?: { x: number; y: number };
}

interface Flow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: any[];
}

interface MyFlowsProps {
  onOpenFlow: (flowId: string) => void;
}

export default function MyFlows({ onOpenFlow }: MyFlowsProps) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchFlows();
  }, []);

  const fetchFlows = async () => {
    try {
      const response = await fetch('/api/flows');
      if (response.ok) {
        const data = await response.json();
        setFlows(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load flows', err);
    } finally {
      setIsLoading(false);
    }
  };

  const createNewFlow = async () => {
    setIsCreating(true);
    const newFlowId = `flow-${Date.now()}`;
    const newFlow: Flow = {
      id: newFlowId,
      name: 'Untitled Flow',
      nodes: [
        {
          id: `trigger-${Date.now()}`,
          type: 'trigger',
          position: { x: 250, y: 150 },
          data: { keyword: 'start' }
        }
      ],
      edges: []
    };

    try {
      const response = await fetch('/api/flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFlow)
      });
      if (response.ok) {
        await fetchFlows();
        onOpenFlow(newFlowId);
      }
    } catch (err) {
      console.error('Failed to create flow', err);
    } finally {
      setIsCreating(false);
    }
  };

  const deleteFlow = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this flow?')) return;
    
    try {
      const response = await fetch(`/api/flows/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        await fetchFlows();
      }
    } catch (err) {
      console.error('Failed to delete flow', err);
    }
  };

  const getTriggerKeyword = (flow: Flow) => {
    const triggerNode = flow.nodes.find(n => n.type === 'trigger');
    return triggerNode?.data?.keyword || 'None';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Flows</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your automated WhatsApp conversation flows.</p>
        </div>
        <button
          onClick={createNewFlow}
          disabled={isCreating}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors shadow-sm"
        >
          {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          Create New Flow
        </button>
      </div>

      {flows.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Workflow size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-2">No flows yet</h3>
          <p className="text-slate-500 text-sm max-w-sm mx-auto mb-6">
            Create your first flow to automate responses, handle leads, and trigger AI handoffs.
          </p>
          <button
            onClick={createNewFlow}
            disabled={isCreating}
            className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Plus size={18} /> Get Started
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {flows.map(flow => (
            <div
              key={flow.id}
              onClick={() => onOpenFlow(flow.id)}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Workflow size={20} />
                </div>
                <button
                  onClick={(e) => deleteFlow(flow.id, e)}
                  className="text-slate-300 hover:text-rose-500 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <h3 className="font-bold text-slate-900 text-lg mb-1 group-hover:text-emerald-700 transition-colors">
                {flow.name || 'Untitled Flow'}
              </h3>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-6 bg-slate-50 w-fit px-2.5 py-1 rounded-lg border border-slate-100">
                <Zap size={12} className="text-amber-500" />
                Trigger: <span className="text-slate-700">"{getTriggerKeyword(flow)}"</span>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between text-sm">
                <span className="text-slate-400 font-medium">{flow.nodes?.length || 0} nodes</span>
                <span className="text-emerald-600 font-bold flex items-center gap-1 group-hover:gap-2 transition-all">
                  Edit Flow <Edit2 size={14} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
