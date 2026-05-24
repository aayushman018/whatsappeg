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
import { 
  Save, MessageSquare, Zap, Bot, MousePointerClick, Loader2,
  Image, List as ListIcon, FileText, Store, ShoppingCart, 
  LayoutTemplate, User, Database, GitBranch, Link, MapPin, Map, 
  HelpCircle, Tag, Globe, BarChart, ArrowLeft, Edit2
} from 'lucide-react';

// --- Custom Nodes ---

const TriggerNode = ({ data, id }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="bg-white border-2 border-emerald-500 rounded-xl shadow-sm min-w-[220px]">
      <div className="bg-emerald-500 px-3 py-2 flex items-center justify-between text-white font-bold text-sm rounded-t-[10px]">
        <div className="flex items-center gap-2"><Zap size={16} /> Trigger Keyword</div>
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
    <div className="bg-white border-2 border-slate-400 rounded-xl shadow-sm min-w-[220px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-500 border-2 border-white" />
      <div className="bg-slate-500 px-3 py-2 flex items-center gap-2 text-white font-bold text-sm rounded-t-[10px]">
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
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-500 border-2 border-white" />
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
    <div className="bg-white border-2 border-indigo-400 rounded-xl shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-indigo-500 border-2 border-white" />
      <div className="bg-indigo-500 px-3 py-2 flex items-center gap-2 text-white font-bold text-sm rounded-t-[10px]">
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
  const { updateNodeData } = useReactFlow();
  return (
    <div className="bg-white border-2 border-amber-400 rounded-xl shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-amber-500 border-2 border-white" />
      <div className="bg-amber-500 px-3 py-2 rounded-t-[10px] flex items-center gap-2 text-white font-bold text-sm">
        <Bot size={16} /> AI Handoff
      </div>
      <div className="p-3 bg-amber-50 rounded-b-[10px] space-y-2">
        <p className="text-xs text-amber-800 font-medium">
          Custom AI Prompt (Optional)
        </p>
        <textarea
          className="w-full px-2 py-1.5 text-[11px] border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none min-h-[80px]"
          value={data.customPrompt || ''}
          onChange={(e) => updateNodeData(id, { customPrompt: e.target.value })}
          placeholder="e.g. You are a sales agent for our pricing plans..."
        />
      </div>
    </div>
  );
};

const SendMediaNode = ({ data, id }: any) => {
  const { updateNodeData } = useReactFlow();
  return (
    <div className="bg-white border-2 border-blue-400 rounded-xl shadow-sm min-w-[240px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-blue-500 border-2 border-white" />
      <div className="bg-blue-500 px-3 py-2 flex items-center gap-2 text-white font-bold text-sm rounded-t-[10px]">
        <Image size={16} /> Send Media
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Media URL (Image, PDF, Video)</label>
          <input
            type="text"
            className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            value={data.mediaUrl || ''}
            onChange={(e) => updateNodeData(id, { mediaUrl: e.target.value })}
            placeholder="https://example.com/file.pdf"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Caption (Optional)</label>
          <textarea
            className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none min-h-[50px]"
            value={data.caption || ''}
            onChange={(e) => updateNodeData(id, { caption: e.target.value })}
            placeholder="Caption text..."
          />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-500 border-2 border-white" />
    </div>
  );
};

// Generic Placeholder Nodes
export const genericNodeTypes = [
  { type: 'mediaButtons', name: 'Media Buttons', icon: Image, color: 'blue' },
  { type: 'list', name: 'List', icon: ListIcon, color: 'emerald' },
  { type: 'whatsappForms', name: 'Whatsapp Forms', icon: FileText, color: 'teal' },
  { type: 'catalogueMessage', name: 'Catalogue Message', icon: Store, color: 'orange' },
  { type: 'singleProduct', name: 'Single Product', icon: ShoppingCart, color: 'orange' },
  { type: 'multiProduct', name: 'Multi Product', icon: ShoppingCart, color: 'orange' },
  { type: 'template', name: 'Template', icon: LayoutTemplate, color: 'purple' },
  
  { type: 'requestIntervention', name: 'Request Intervention', icon: User, color: 'rose' },
  { type: 'metaConversions', name: 'Meta Conversions Api', icon: Database, color: 'blue' },
  { type: 'condition', name: 'Condition', icon: GitBranch, color: 'indigo' },
  { type: 'connectFlow', name: 'Connect Flow', icon: Link, color: 'slate' },
  { type: 'askAddress', name: 'Ask Address', icon: MapPin, color: 'emerald' },
  { type: 'askLocation', name: 'Ask Location', icon: Map, color: 'emerald' },
  { type: 'askQuestion', name: 'Ask Question', icon: HelpCircle, color: 'amber' },
  { type: 'askMedia', name: 'Ask Media', icon: Image, color: 'amber' },
  { type: 'setAttribute', name: 'Set Attribute', icon: Tag, color: 'slate' },
  { type: 'addTag', name: 'Add Tag', icon: Tag, color: 'slate' },
  { type: 'apiRequest', name: 'API Request', icon: Globe, color: 'indigo' },
  
  { type: 'easyinsights', name: 'Easyinsights', icon: BarChart, color: 'purple' },
];

const colorMap: Record<string, string> = {
  blue: "bg-blue-500 border-blue-400",
  emerald: "bg-emerald-500 border-emerald-400",
  teal: "bg-teal-500 border-teal-400",
  orange: "bg-orange-500 border-orange-400",
  purple: "bg-purple-500 border-purple-400",
  rose: "bg-rose-500 border-rose-400",
  indigo: "bg-indigo-500 border-indigo-400",
  slate: "bg-slate-500 border-slate-400",
  amber: "bg-amber-500 border-amber-400",
};

const handleBgMap: Record<string, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  rose: "bg-rose-500",
  indigo: "bg-indigo-500",
  slate: "bg-slate-500",
  amber: "bg-amber-500",
};

const GenericNode = ({ type, id }: any) => {
  const config = genericNodeTypes.find(t => t.type === type);
  if (!config) return null;
  const Icon = config.icon;
  
  const className = colorMap[config.color] || colorMap.slate;
  const borderClass = className.split(' ')[1];
  const handleBg = handleBgMap[config.color] || handleBgMap.slate;

  return (
    <div className={`bg-white border-2 rounded-xl shadow-sm min-w-[200px] ${borderClass}`}>
      <Handle type="target" position={Position.Top} className={`w-3 h-3 border-2 border-white ${handleBg}`} />
      <div className={`px-3 py-2 flex items-center gap-2 text-white font-bold text-sm rounded-t-[10px] ${handleBg}`}>
        <Icon size={16} /> {config.name}
      </div>
      <div className="p-3 text-sm text-center font-medium text-slate-500 bg-slate-50 rounded-b-[10px]">
        (Placeholder)
      </div>
      <Handle type="source" position={Position.Bottom} className={`w-3 h-3 border-2 border-white ${handleBg}`} />
    </div>
  );
};

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  button: ButtonNode,
  aiHandoff: AiHandoffNode,
  sendMedia: SendMediaNode,
};

genericNodeTypes.forEach(config => {
  nodeTypes[config.type] = (props: any) => <GenericNode {...props} />;
});

// --- Sidebar Component ---

const Sidebar = () => {
  const [activeTab, setActiveTab] = useState('BUILDER');

  const onDragStart = (event: DragEvent<HTMLDivElement>, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const renderDraggable = (type: string, name: string, Icon: any) => (
    <div
      className="flex flex-col items-center justify-center p-3 border border-slate-200 rounded-xl bg-white hover:border-emerald-500 hover:shadow-sm cursor-grab text-slate-700 transition-all gap-2"
      onDragStart={(event) => onDragStart(event, type)}
      draggable
    >
      <Icon size={24} className="text-emerald-600" />
      <span className="text-xs font-medium text-center">{name}</span>
    </div>
  );

  return (
    <aside className="w-[340px] bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
      <div className="flex items-center px-4 py-3 bg-white border-b border-slate-200 gap-3 shrink-0">
         <button className="p-1 hover:bg-slate-100 rounded-lg text-slate-500"><ArrowLeft size={20}/></button>
         <h2 className="font-medium text-xl flex items-center gap-2">Untitled <button className="inline bg-slate-100 p-1 rounded hover:bg-slate-200 transition-colors"><Edit2 size={14} className="text-slate-600"/></button></h2>
      </div>

      <div className="flex border-b border-slate-200 bg-white shrink-0 text-xs font-bold text-slate-500">
        <button 
          className={`flex-1 py-3 border-b-[3px] text-center transition-colors ${activeTab === 'BUILDER' ? 'border-emerald-700 text-emerald-800' : 'border-transparent hover:bg-slate-50'}`}
          onClick={() => setActiveTab('BUILDER')}
        >
          BUILDER
        </button>
        <button 
          className={`flex-1 py-3 border-b-[3px] text-center transition-colors ${activeTab === 'KNOWLEDGE BASE' ? 'border-emerald-700 text-emerald-800' : 'border-transparent hover:bg-slate-50'}`}
          onClick={() => setActiveTab('KNOWLEDGE BASE')}
        >
          KNOWLEDGE BASE
        </button>
        <button 
          className={`flex-1 py-3 border-b-[3px] text-center transition-colors ${activeTab === 'TOOL CALLING' ? 'border-emerald-700 text-emerald-800' : 'border-transparent hover:bg-slate-50'}`}
          onClick={() => setActiveTab('TOOL CALLING')}
        >
          TOOL CALLING
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20 custom-scrollbar">
        {activeTab === 'BUILDER' && (
          <>
            <div>
              <div className="grid grid-cols-2 gap-3">
                {renderDraggable('trigger', 'Trigger Keyword', Zap)}
                {renderDraggable('button', 'Text Buttons', MousePointerClick)}
                {renderDraggable('mediaButtons', 'Media Buttons', Image)}
                {renderDraggable('list', 'List', ListIcon)}
                {renderDraggable('whatsappForms', 'Whatsapp Forms', FileText)}
                {renderDraggable('catalogueMessage', 'Catalogue Message', Store)}
                {renderDraggable('singleProduct', 'Single Product', ShoppingCart)}
                {renderDraggable('multiProduct', 'Multi Product', ShoppingCart)}
                {renderDraggable('template', 'Template', LayoutTemplate)}
                {renderDraggable('message', 'Message', MessageSquare)}
                {renderDraggable('sendMedia', 'Send Media', Image)}
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-slate-700 mb-3 tracking-wide">Actions</h3>
              <div className="grid grid-cols-2 gap-3">
                {renderDraggable('requestIntervention', 'Request Intervention', User)}
                {renderDraggable('metaConversions', 'Meta Conversions Api', Database)}
                {renderDraggable('condition', 'Condition', GitBranch)}
                {renderDraggable('connectFlow', 'Connect Flow', Link)}
                {renderDraggable('askAddress', 'Ask Address', MapPin)}
                {renderDraggable('askLocation', 'Ask Location', Map)}
                {renderDraggable('askQuestion', 'Ask Question', HelpCircle)}
                {renderDraggable('askMedia', 'Ask Media', Image)}
                {renderDraggable('setAttribute', 'Set Attribute', Tag)}
                {renderDraggable('addTag', 'Add Tag', Tag)}
                {renderDraggable('apiRequest', 'API Request', Globe)}
                {renderDraggable('aiHandoff', 'AI Handoff', Bot)}
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-slate-700 mb-3 tracking-wide">Integrations</h3>
              <div className="grid grid-cols-2 gap-3">
                {renderDraggable('easyinsights', 'Easyinsights', BarChart)}
              </div>
            </div>
          </>
        )}
        
        {activeTab === 'KNOWLEDGE BASE' && (
           <div className="text-sm text-slate-500 text-center py-10">Knowledge Base coming soon.</div>
        )}

        {activeTab === 'TOOL CALLING' && (
           <div className="text-sm text-slate-500 text-center py-10">Tool Calling coming soon.</div>
        )}
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 10px;
        }
      `}</style>
    </aside>
  );
};

// --- Main App ---

export default function FlowBuilder({ flowId, onBack }: { flowId: string, onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <FlowBuilderContent flowId={flowId} onBack={onBack} />
    </ReactFlowProvider>
  );
}

function FlowBuilderContent({ flowId, onBack }: { flowId: string, onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [flowName, setFlowName] = useState('Untitled Flow');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const response = await fetch('/api/flows');
        if (response.ok) {
          const flows = await response.json();
          const currentFlow = (Array.isArray(flows) ? flows : []).find((f: any) => f.id === flowId);
          if (currentFlow) {
            setNodes(currentFlow.nodes || []);
            setEdges(currentFlow.edges || []);
            setFlowName(currentFlow.name || 'Untitled Flow');
          } else {
            setNodes([]);
            setEdges([]);
          }
        }
      } catch (err) {
        console.error('Failed to load flow:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchFlow();
  }, [flowId]);

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
          id: flowId,
          name: flowName,
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
        <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              &larr; Back to flows
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              className="font-bold text-slate-900 text-sm focus:outline-none focus:bg-slate-50 px-2 py-1 rounded transition-colors"
              placeholder="Flow Name"
            />
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
