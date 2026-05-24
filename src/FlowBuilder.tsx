import { useCallback, useState, useEffect, DragEvent, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Handle,
  Position,
  Node,
  Edge,
  NodeTypes,
  ReactFlowProvider,
  NodeChange,
  EdgeChange,
  Connection,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Save, MessageSquare, Zap, Bot, MousePointerClick, Loader2 } from 'lucide-react';

// --- Custom Nodes ---

const TriggerNode = ({ data, id }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="bg-white border-2 border-emerald-500 rounded-xl shadow-sm min-w-[220px]">
      <div className="bg-emerald-500 px-3 py-2 flex items-center justify-between text-white font-bold text-sm rounded-t-[10px]">
        <div className="flex items-center gap-2"><Zap size={16} /> Trigger</div>
      </div>
      <div className="p-3">
        <label className="block text-xs font-medium text-slate-700 mb-1">Trigger Keyword</label>
        <input
          type="text"
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
          value={data.keyword || ''}
          onChange={(e) => updateNodeData(id, { keyword: e.target.value })}
          placeholder="e.g. hello, hi"
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-emerald-500 border-2 border-white" />
    </div>
  );
};

const MessageNode = ({ data, id }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm min-w-[220px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-400 border-2 border-white" />
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center gap-2 text-slate-700 font-bold text-sm rounded-t-xl">
        <MessageSquare size={16} /> Send Message
      </div>
      <div className="p-3">
        <label className="block text-xs font-medium text-slate-700 mb-1">Message Content</label>
        <textarea
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none min-h-[60px]"
          value={data.message || ''}
          onChange={(e) => updateNodeData(id, { message: e.target.value })}
          placeholder="Type message here..."
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-400 border-2 border-white" />
    </div>
  );
};

const ButtonNode = ({ data, id }: any) => {
  const { updateNodeData } = useReactFlow();
  const buttons: string[] = data.buttons || [''];

  const updateButton = (index: number, value: string) => {
    const newButtons = [...buttons];
    newButtons[index] = value;
    updateNodeData(id, { buttons: newButtons });
  };

  const addButton = () => {
    if (buttons.length < 3) {
      updateNodeData(id, { buttons: [...buttons, ''] });
    }
  };

  const removeButton = (index: number) => {
    const newButtons = buttons.filter((_: any, i: number) => i !== index);
    updateNodeData(id, { buttons: newButtons });
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-xl shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-indigo-400 border-2 border-white" />
      <div className="bg-indigo-50 border-b border-indigo-100 px-3 py-2 flex items-center gap-2 text-indigo-700 font-bold text-sm rounded-t-xl">
        <MousePointerClick size={16} /> Interactive Buttons
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Message Body</label>
          <textarea
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none min-h-[50px]"
            value={data.message || ''}
            onChange={(e) => updateNodeData(id, { message: e.target.value })}
            placeholder="Main text..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Buttons (Max 3)</label>
          <div className="space-y-2 relative">
            {buttons.map((btn, i) => (
              <div key={i} className="flex items-center gap-2 relative group">
                <input
                  type="text"
                  className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none"
                  value={btn}
                  onChange={(e) => updateButton(i, e.target.value)}
                  placeholder={`Button ${i + 1}`}
                />
                <button
                  onClick={() => removeButton(i)}
                  className="text-slate-300 hover:text-rose-500 font-bold px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  &times;
                </button>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`btn-${i}`}
                  className="w-3 h-3 bg-indigo-500 border-2 border-white"
                  style={{ top: '50%', right: '-25px', transform: 'translateY(-50%)' }}
                />
              </div>
            ))}
            {buttons.length < 3 && (
              <button
                onClick={addButton}
                className="w-full py-1.5 mt-1 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-100 font-medium transition-colors"
              >
                + Add Button
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const AiHandoffNode = ({ data, id }: any) => {
  return (
    <div className="bg-white border-2 border-amber-400 rounded-xl shadow-sm min-w-[220px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-amber-500 border-2 border-white" />
      <div className="bg-amber-400 px-3 py-2 rounded-t-[10px] flex items-center gap-2 text-amber-900 font-bold text-sm">
        <Bot size={16} /> AI Handoff
      </div>
      <div className="p-3 bg-amber-50 rounded-b-[10px]">
        <p className="text-xs text-amber-800 text-center font-medium">
          Conversation handed to AI Agent.
        </p>
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  button: ButtonNode,
  aiHandoff: AiHandoffNode,
};

// --- Sidebar Component ---

const Sidebar = () => {
  const onDragStart = (event: DragEvent<HTMLDivElement>, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-3 overflow-y-auto shrink-0">
      <div>
        <h3 className="font-bold text-slate-900 text-sm mb-1">Nodes</h3>
        <p className="text-xs text-slate-500 mb-2">Drag components to the canvas</p>
      </div>
      
      <div
        className="border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-sm font-medium cursor-grab flex items-center gap-2 hover:bg-emerald-100 transition-colors"
        onDragStart={(event) => onDragStart(event, 'trigger')}
        draggable
      >
        <Zap size={16} /> Trigger Keyword
      </div>
      <div
        className="border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 rounded-xl text-sm font-medium cursor-grab flex items-center gap-2 hover:bg-slate-100 transition-colors"
        onDragStart={(event) => onDragStart(event, 'message')}
        draggable
      >
        <MessageSquare size={16} /> Message
      </div>
      <div
        className="border border-indigo-200 bg-indigo-50 text-indigo-700 px-3 py-2 rounded-xl text-sm font-medium cursor-grab flex items-center gap-2 hover:bg-indigo-100 transition-colors"
        onDragStart={(event) => onDragStart(event, 'button')}
        draggable
      >
        <MousePointerClick size={16} /> Interactive Buttons
      </div>
      <div
        className="border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 rounded-xl text-sm font-medium cursor-grab flex items-center gap-2 hover:bg-amber-100 transition-colors"
        onDragStart={(event) => onDragStart(event, 'aiHandoff')}
        draggable
      >
        <Bot size={16} /> AI Handoff
      </div>
    </aside>
  );
};

// --- Main App ---

export default function FlowBuilder() {
  return (
    <ReactFlowProvider>
      <FlowBuilderContent />
    </ReactFlowProvider>
  );
}

function FlowBuilderContent() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const response = await fetch('/api/flows');
        if (response.ok) {
          const data = await response.json();
          if (data && data.nodes) {
            setNodes(data.nodes);
            setEdges(data.edges || []);
          }
        } else if (response.status === 404) {
          setNodes([]);
          setEdges([]);
        }
      } catch (err) {
        console.error('Failed to load flow:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchFlow();
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `node-${Date.now()}`,
        type,
        position,
        data: {},
      };

      if (type === 'button') {
        newNode.data = { buttons: ['Button 1'] };
      }

      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition]
  );

  const onSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/flows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'default',
          name: 'Welcome Flow',
          nodes,
          edges,
        }),
      });
      if (response.ok) {
        alert('Flow saved successfully!');
      } else {
        alert('Failed to save flow');
      }
    } catch (err) {
      alert('Failed to save flow');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50 w-full">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-slate-50 overflow-hidden text-left">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0" ref={reactFlowWrapper}>
        <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
          <div>
            <h2 className="font-bold text-slate-900 text-sm">Welcome Flow</h2>
            <p className="text-xs text-slate-500">Auto-responses for initial contact</p>
          </div>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-70"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSaving ? 'Saving...' : 'Save Flow'}
          </button>
        </div>
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            className="bg-slate-50"
          >
            <Background gap={16} />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
