import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { 
  Activity, 
  Search, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  AlertTriangle, 
  Power, 
  LayoutDashboard,
  Settings,
  ChevronRight,
  Info,
  CheckCircle,
  XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";

interface ONU {
  name: string;
  sn: string;
  olt_id: string;
  board: string;
  port: string;
  onu: string;
  status?: string;
  signal?: string;
  onu_type_name?: string;
  zone?: string;
  status_changed_at?: string;
  upload_speed?: string;
  download_speed?: string;
}

export default function App() {
  useEffect(() => {
    console.log('Environment check:', {
      hasFetch: typeof window !== 'undefined' && 'fetch' in window,
      fetchType: typeof window !== 'undefined' ? typeof window.fetch : 'undefined'
    });
  }, []);

  const [subdomain] = useState("intalnet.vortex-m2.com");
  const [apiKey] = useState("3332756bd57545ba99a55b54fa666c18");
  const [onus, setOnus] = useState<ONU[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOnu, setSelectedOnu] = useState<ONU | null>(null);
  const [onuHistory, setOnuHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [ponOutages, setPonOutages] = useState<any[]>([]);
  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [apiError, setApiError] = useState<string | null>(null);
  const [olts, setOlts] = useState<any[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dataMode, setDataMode] = useState<'live' | 'cached' | 'fallback'>('live');
  const [lastSyncStatus, setLastSyncStatus] = useState<{sync_time: string, sync_type: string} | null>(null);
  const [expandedPort, setExpandedPort] = useState<string | null>(null);
  const [outagePage, setOutagePage] = useState(1);
  const [selectedOltFilter, setSelectedOltFilter] = useState('all');
  const [selectedBoardFilter, setSelectedBoardFilter] = useState('all');
  const [selectedPortFilter, setSelectedPortFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [onusThreshold, setOnusThreshold] = useState<number>(7);
  const [syncFallback, setSyncFallback] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await axios.get('/api/auth-check');
      if (res.data.authenticated) {
        setIsAuthenticated(true);
        setSessionUser(res.data.user);
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await axios.post('/api/login', { email: loginEmail, password: loginPassword });
      if (res.data.success) {
        setIsAuthenticated(true);
        setSessionUser(res.data.user);
      }
    } catch (err: any) {
      setLoginError(err.response?.data?.error || "Invalid credentials");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/logout');
      setIsAuthenticated(false);
      setSessionUser(null);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/local/settings');
      if (res.data?.FALLEN_PORT_THRESHOLD) {
        setOnusThreshold(parseInt(res.data.FALLEN_PORT_THRESHOLD));
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  }, []);

  const updateThreshold = async (val: number) => {
    setOnusThreshold(val);
    try {
      await axios.post('/api/local/settings', { FALLEN_PORT_THRESHOLD: val });
    } catch (err) {
      console.error("Failed to update threshold:", err);
    }
  };

  const getOltName = useCallback((id: string | number) => {
    const olt = olts.find(o => String(o.id || o.olt_id) === String(id));
    return olt ? (olt.name || olt.olt_name || `OLT ${id}`) : `OLT ${id}`;
  }, [olts]);

  const [specialOnus, setSpecialOnus] = useState<any[]>([]);
  const [newSpecialSN, setNewSpecialSN] = useState("");
  const [specialAlertConfig, setSpecialAlertConfig] = useState({ los: true, power: true, offline: false });
  const [addingSpecial, setAddingSpecial] = useState(false);
  const [specialError, setSpecialError] = useState<string | null>(null);

  const fetchSpecialOnus = useCallback(async () => {
    try {
      const res = await axios.get('/api/local/special-onus');
      setSpecialOnus(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Failed to fetch special onus:", err);
    }
  }, []);

  const addSpecialOnu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpecialSN) return;
    setAddingSpecial(true);
    setSpecialError(null);
    try {
      await axios.post('/api/local/special-onus', {
        sn: newSpecialSN,
        alert_on_los: specialAlertConfig.los,
        alert_on_power_fail: specialAlertConfig.power,
        alert_on_offline: specialAlertConfig.offline
      });
      setNewSpecialSN("");
      fetchSpecialOnus();
    } catch (err: any) {
      setSpecialError(err.response?.data?.error || "Error al agregar la ONU.");
    } finally {
      setAddingSpecial(false);
    }
  };

  const removeSpecialOnu = async (sn: string) => {
    try {
      await axios.delete(`/api/local/special-onus/${sn}`);
      fetchSpecialOnus();
    } catch (err) {
      console.error("Failed to remove special onu:", err);
    }
  };

  const fetchOnuHistory = async (sn: string) => {
    if (!subdomain || !apiKey) return;
    setHistoryLoading(true);
    const cleanHost = subdomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    try {
      // Common SmartOLT log endpoint pattern
      const res = await axios.get(`/api/smartolt/${cleanHost}/onu/get_onu_logs/${sn}`, {
        headers: { "X-API-Key": apiKey }
      });
      setOnuHistory(Array.isArray(res.data) ? res.data : (res.data.logs || res.data.data || []));
    } catch (err) {
      console.error("Failed to fetch ONU history:", err);
      setOnuHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOnuClick = (onu: ONU) => {
    setSelectedOnu(onu);
    fetchOnuHistory(onu.sn);
  };

  const checkConnection = useCallback(async () => {
    if (!subdomain || !apiKey) return;
    setApiStatus('testing');
    setApiError(null);
    const cleanHost = subdomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    try {
      const res = await axios.get(`/api/smartolt/${cleanHost}/system/get_olts`, {
        headers: { "X-API-Key": apiKey }
      });
      let fetchedOlts = [];
      if (Array.isArray(res.data)) {
        fetchedOlts = res.data;
      } else if (res.data && Array.isArray(res.data.response)) {
        fetchedOlts = res.data.response;
      } else if (res.data && res.data.response && Array.isArray(res.data.response.olts)) {
        fetchedOlts = res.data.response.olts;
      } else {
        fetchedOlts = res.data?.olts || res.data?.data || [];
      }
      setOlts(fetchedOlts);
      setApiStatus('success');
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error("API Connection Test Failed:", err);
      setApiStatus('error');
      setApiError(err.response?.data?.error || err.message || "Authentication failed");
    }
  }, [subdomain, apiKey]);

  const forceSyncDB = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/local/sync');
      setDataMode(res.data.fallback ? 'fallback' : 'live');
      setSyncFallback(!!res.data.fallback);
      await fetchONUs();
    } catch (err: any) {
      console.error("Sync Error:", err);
      setError("Failed to sync database: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchONUs = useCallback(async (isBackground: boolean = false) => {
    if (!isBackground) setLoading(true);
    setRefreshing(true);
    setError(null);

    try {
      const statusRes = await axios.get('/api/local/sync-status');
      if (statusRes.data?.sync_time) {
        setLastSyncStatus(statusRes.data);
      }

      const dbRes = await axios.get('/api/local/onus');
      const combinedOnus = Array.isArray(dbRes.data) ? dbRes.data : [];
      setOnus(combinedOnus);
      // Calculate PON Outages based on > 50% offline threshold
      const portMap = new Map();
      const portTotals = new Map<string, number>();
      
      // Pre-calculate totals per port
      combinedOnus.forEach(o => {
        const key = `${o.olt_id}-${o.board}-${o.port}`;
        portTotals.set(key, (portTotals.get(key) || 0) + 1);
      });

      combinedOnus.forEach(o => {
        const key = `${o.olt_id}-${o.board}-${o.port}`;
        if (!portMap.has(key)) {
          portMap.set(key, {
            olt_id: o.olt_id,
            board: o.board,
            port: o.port,
            total_onus: portTotals.get(key) || 0,
            los: 0,
            power: 0,
            cause: "Unknown",
            since: "Just now" // Placeholder as SmartOLT doesn't always provide this in bulk
          });
        }
        
        const adminStatus = o.admin_status?.toLowerCase();
        if (adminStatus !== 'disabled') {
          const status = o.status?.toLowerCase() || "";
          const portData = portMap.get(key);
          if (status === "los") portData.los += 1;
          if (status === "power fail") portData.power += 1;
        }
      });
      
      Array.from(portMap.values()).forEach(p => {
        p.cause = "LOS"; // Fallback cause for the table
      });
      
      setPonOutages(Array.from(portMap.values()));
      setLastUpdated(new Date());

    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "An error occurred while fetching data.");
    } finally {
      setRefreshing(false);
      if (!isBackground) setLoading(false);
    }
  }, [subdomain, apiKey]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated && subdomain && apiKey) {
      checkConnection();
      fetchSettings();
      fetchONUs();
      fetchSpecialOnus();
      
      const interval = setInterval(() => {
        fetchONUs(true);
        fetchSpecialOnus();
      }, 60000); 
      return () => clearInterval(interval);
    }
  }, [checkConnection, fetchONUs, subdomain, apiKey, isAuthenticated, fetchSettings, fetchSpecialOnus]);

  const filteredOnus = onus.filter(o => 
    (o.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
    (o.sn || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusIcon = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "online": return <Wifi className="w-4 h-4 text-emerald-500" />;
      case "offline": return <WifiOff className="w-4 h-4 text-slate-400" />;
      case "los": return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      case "power fail": return <Power className="w-4 h-4 text-amber-500" />;
      default: return <Info className="w-4 h-4 text-slate-300" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "online": return "text-emerald-500 bg-emerald-500/10";
      case "offline": return "text-slate-400 bg-slate-400/10";
      case "los": return "text-rose-500 bg-rose-500/10";
      case "power fail": return "text-amber-500 bg-amber-500/10";
      default: return "text-slate-300 bg-slate-300/10";
    }
  };
  
  const timeAgo = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diffMs = Math.abs(now.getTime() - date.getTime());
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <Activity className="w-8 h-8 animate-pulse opacity-20" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center p-4 selection:bg-[#E4E3E0] selection:text-[#141414]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1c1c1c] border border-white/5 p-8 relative z-10 shadow-2xl rounded-sm"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-[#E4E3E0] flex items-center justify-center rounded-sm">
              <Activity className="text-[#141414] w-6 h-6" />
            </div>
            <div>
              <h1 className="text-[#E4E3E0] font-serif italic text-2xl tracking-tight">SmartOLT Monitor</h1>
              <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-[#E4E3E0]/40">Internal Dashboard v1.0</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold tracking-widest text-[#E4E3E0]/40">Email Address</label>
              <input 
                type="email" 
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-[#E4E3E0] font-mono text-sm focus:outline-none focus:border-emerald-500/50 transition-colors rounded-sm"
                placeholder="email@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold tracking-widest text-[#E4E3E0]/40">Password</label>
              <input 
                type="password" 
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 px-4 py-3 text-[#E4E3E0] font-mono text-sm focus:outline-none focus:border-emerald-500/50 transition-colors rounded-sm"
                placeholder="••••••••"
              />
            </div>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-rose-500 text-xs font-bold uppercase tracking-wider bg-rose-500/10 border border-rose-500/20 p-3 rounded-sm flex items-center gap-2"
              >
                <AlertTriangle className="w-3 h-3" />
                {loginError}
              </motion.div>
            )}

            <button 
              type="submit"
              disabled={loggingIn}
              className="w-full bg-[#E4E3E0] text-[#141414] py-3 text-xs font-black uppercase tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2 rounded-sm"
            >
              {loggingIn ? "Authenticating..." : "Access Dashboard"}
              {!loggingIn && <ChevronRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="mt-8 text-center text-[9px] uppercase font-bold tracking-widest text-white/20">
            Secure Session Management Active
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] bg-white/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#141414] flex items-center justify-center rounded-sm">
              <Activity className="text-[#E4E3E0] w-5 h-5" />
            </div>
            <h1 className="font-serif italic text-xl tracking-tight">SmartOLT Monitor</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider transition-all",
              apiStatus === 'testing' && "bg-slate-100 border-slate-200 text-slate-400 animate-pulse",
              apiStatus === 'success' && "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
              apiStatus === 'error' && "bg-rose-500/10 border-rose-500/20 text-rose-500",
              apiStatus === 'idle' && "bg-slate-100 border-slate-200 text-slate-400"
            )}>
              {apiStatus === 'testing' && <RefreshCw className="w-3 h-3 animate-spin" />}
              {apiStatus === 'success' && <CheckCircle className="w-3 h-3" />}
              {apiStatus === 'error' && <XCircle className="w-3 h-3" />}
              {apiStatus === 'idle' && <Activity className="w-3 h-3" />}
              <span>
                {apiStatus === 'testing' && "Testing API..."}
                {apiStatus === 'success' && "API Connected"}
                {apiStatus === 'error' && "Auth Error"}
                {apiStatus === 'idle' && "API Idle"}
              </span>
            </div>
            
            {lastSyncStatus && lastSyncStatus.sync_time && (
              <div className="flex flex-col items-end mr-2 text-right">
                <span className="text-[9px] uppercase tracking-widest font-bold opacity-40">Last Full Sync</span>
                <span className="text-xs font-mono font-medium">
                  {new Date(lastSyncStatus.sync_time + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
                  <span className="text-[9px] opacity-50 ml-1">({lastSyncStatus.sync_type})</span>
                </span>
              </div>
            )}

            <div className="flex flex-col items-start mr-2 bg-slate-100/50 p-2 rounded-sm border border-[#141414]/5">
              <span className="text-[9px] uppercase tracking-widest font-bold opacity-40 mb-1">Umbral ONUs</span>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  min="0" 
                  max="128"
                  value={onusThreshold} 
                  onChange={(e) => updateThreshold(parseInt(e.target.value) || 0)}
                  className="w-12 bg-transparent border-b border-[#141414]/20 text-xs font-mono focus:outline-none focus:border-[#141414] transition-colors"
                />
                <Settings className="w-3 h-3 opacity-30" />
              </div>
            </div>

            <button 
              onClick={forceSyncDB}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-500 border border-blue-500/20 text-xs font-bold uppercase tracking-widest hover:bg-blue-500/20 transition-all disabled:opacity-50 rounded-sm"
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
              Sync DB
            </button>
            <button 
              onClick={() => {
                checkConnection();
                fetchONUs();
              }}
              disabled={loading}
              className={cn(
                "flex items-center gap-2 px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50 rounded-sm",
                loading && "animate-pulse"
              )}
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button 
              onClick={handleLogout}
              className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-sm transition-colors border border-transparent hover:border-rose-500/20"
              title="Cerrar Sesión"
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {expandedPort ? (() => {
          const [oltId, board, port] = expandedPort.split('-');
          const affectedOnusList = onus.filter(o => String(o.olt_id) === oltId && String(o.board) === board && String(o.port) === port);
          
          const portLos = affectedOnusList.filter(o => o.status?.toLowerCase() === 'los').length;
          const portPower = affectedOnusList.filter(o => o.status?.toLowerCase() === 'power fail').length;
          const portOnline = affectedOnusList.filter(o => o.status?.toLowerCase() === 'online').length;
          const portOffline = affectedOnusList.length - portLos - portPower - portOnline;

          return (
            <div className="bg-white border border-[#141414]/10 shadow-sm animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between p-6 border-b border-[#141414]/10 bg-slate-50">
                <div>
                  <h2 className="text-xl font-serif italic tracking-tight mb-2">
                    {getOltName(oltId)} — Tarjeta {board} / Puerto {port}
                  </h2>
                  <div className="flex gap-2 flex-wrap text-[10px] uppercase tracking-widest font-bold">
                    <span className="px-2 py-1 bg-[#141414]/5 text-[#141414]/60 rounded-sm">
                      Total: {affectedOnusList.length}
                    </span>
                    <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 rounded-sm">
                      Online: {portOnline}
                    </span>
                    <span className="px-2 py-1 bg-rose-500/10 text-rose-600 rounded-sm">
                      LOS: {portLos}
                    </span>
                    <span className="px-2 py-1 bg-amber-500/10 text-amber-600 rounded-sm">
                      Power Fail: {portPower}
                    </span>
                    {portOffline > 0 && (
                      <span className="px-2 py-1 bg-slate-500/10 text-slate-600 rounded-sm">
                        Offline: {portOffline}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => setExpandedPort(null)}
                  className="px-4 py-2 bg-[#141414]/5 hover:bg-[#141414]/10 border border-[#141414]/10 text-xs font-bold uppercase tracking-widest transition-colors rounded-sm"
                >
                  Regresar al Dashboard
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-[#141414]/40 bg-white">
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Sincronismo</th>
                      <th className="px-6 py-4">Velocidad (UP/DOWN)</th>
                      <th className="px-6 py-4">Signal</th>
                      <th className="px-6 py-4">Distance</th>
                      <th className="px-6 py-4">Name</th>
                      <th className="px-6 py-4">Address / Comment</th>
                      <th className="px-6 py-4">SN / MAC</th>
                      <th className="px-6 py-4">Zone</th>
                      <th className="px-6 py-4">ODB</th>
                      <th className="px-6 py-4">ONU Ind.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {affectedOnusList.map((onu, j) => {
                      let rawData = {} as any;
                      try {
                        if (onu.raw_data) rawData = JSON.parse(onu.raw_data);
                      } catch(e) {}
                      
                      const signal = rawData.signal || onu.signal || "-";
                      const distance = rawData.distance || "-";
                      const address = rawData.address || "-";
                      const odb = rawData.odb_name || "-";
                      const zone = onu.zone_name || onu.zone_id || onu.zone || rawData.zone_name || "-";
                      const onuPath = `${getOltName(onu.olt_id)} gpon-onu_${onu.board}/${onu.port}:${onu.onu}`;
                      
                      return (
                        <tr key={j} className="hover:bg-slate-50">
                          <td className="px-6 py-4 font-mono text-xs font-bold uppercase tracking-wider">
                            <span className={cn(
                              (onu.status || "").toLowerCase() === 'online' ? "text-emerald-500" :
                              ["los", "power fail"].includes((onu.status || "").toLowerCase()) ? "text-rose-500" :
                              "text-amber-500"
                            )}>
                              {onu.status || "Unknown"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-[10px] font-mono opacity-60">
                             {timeAgo(onu.status_changed_at)}
                          </td>
                          <td className="px-6 py-4 text-[10px] font-mono">
                             {onu.upload_speed && onu.upload_speed !== 'Unknown' ? (
                               <span className="flex flex-col">
                                 <span className="text-emerald-600">UP: {onu.upload_speed}</span>
                                 <span className="text-blue-600">DN: {onu.download_speed}</span>
                               </span>
                             ) : (
                               <span className="opacity-30 italic">Enriqueciendo...</span>
                             )}
                          </td>
                          <td className="px-6 py-4 font-mono text-xs">{signal}</td>
                          <td className="px-6 py-4 font-mono text-xs">{distance}</td>
                          <td className="px-6 py-4 max-w-[200px] truncate" title={onu.name}>{onu.name}</td>
                          <td className="px-6 py-4 max-w-[200px] truncate text-xs opacity-80" title={address}>{address}</td>
                          <td className="px-6 py-4 font-mono text-blue-500 cursor-pointer" onClick={() => handleOnuClick(onu)}>{onu.sn}</td>
                          <td className="px-6 py-4">{zone}</td>
                          <td className="px-6 py-4">{odb}</td>
                          <td className="px-6 py-4 text-xs text-slate-500 font-mono">{onuPath}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })() : (
        <>
        {/* OLTs and Last Updated Info */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div className="flex flex-wrap gap-2">
            {olts.map((olt, i) => (
              <div key={i} className="px-3 py-1 bg-white border border-[#141414]/10 rounded-full flex items-center gap-2 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider">{olt.name || olt.olt_name || `OLT ${olt.id || olt.olt_id || i}`}</span>
                {olt.hardware_type && <span className="text-[9px] opacity-40 font-mono">({olt.hardware_type})</span>}
              </div>
            ))}
            {apiStatus === 'success' && olts.length === 0 && (
              <p className="text-[10px] opacity-40 italic">No OLTs found</p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {dataMode === 'live' && (
              <div className="flex items-center gap-2 text-emerald-500 bg-emerald-500/5 px-3 py-1 border border-emerald-500/10" title="Estados vitales consultados en vivo directo de SmartOLT">
                <Activity className="w-3 h-3" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Monitoreo Activo</span>
              </div>
            )}
            {dataMode === 'fallback' && (
              <div className="flex items-center gap-2 text-amber-500 bg-amber-500/5 px-3 py-1 border border-amber-500/10" title="API caída. Usando última lectura guardada.">
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Modo Desconectado</span>
              </div>
            )}
            {lastUpdated && (
              <div className="flex items-center gap-2 text-slate-500 bg-slate-500/5 px-3 py-1 border border-slate-500/10" title="Hora de sincronización local">
                <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin text-emerald-500")} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Actualizado a las: {lastUpdated.toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="mb-8 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold uppercase tracking-widest text-[10px] mb-1">Error Detected</p>
              <p>{error}</p>
              {error.includes("403") && (
                <p className="mt-2 text-xs opacity-80">
                  Tip: Make sure your API Key is correct and "Allowed from anywhere" is set in SmartOLT Settings {"->"} API.
                </p>
              )}
            </div>
          </div>
        )}

        {syncFallback && (
          <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-bold uppercase tracking-widest text-[10px] mb-1">Sincronización Limitada (Rate Limit)</p>
              <p>SmartOLT ha limitado las peticiones de detalles. Los estados básicos están actualizados, pero los detalles técnicos (distancia, ODB, etc.) podrían ser antiguos.</p>
              <p className="mt-1 text-[10px] opacity-70 italic">Límite: Máximo 3 sincronizaciones detalladas por hora.</p>
            </div>
          </div>
        )}

        {(!subdomain || !apiKey) && !error && (
          <div className="mb-8 p-8 bg-white border border-[#141414] text-center">
            <Settings className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <h2 className="text-xl font-serif italic mb-2">Setup Required</h2>
            <p className="text-sm opacity-60 mb-6 max-w-md mx-auto">
              Please configure your SmartOLT domain and API Key in the settings menu (gear icon in the top right) to start monitoring your ONUs.
            </p>
          </div>
        )}

        {/* Stats Summary */}
        {(() => {
          const totallyFallen = ponOutages.filter(p => p.total_onus > onusThreshold && (p.los / p.total_onus) >= 0.35);
          const totalPorts = ponOutages.length;

          return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-[#141414] border border-[#141414] mb-8">
              {[
                { label: "Total ONUs", value: onus.length },
                { label: "Online", value: onus.filter(o => o.status?.toLowerCase() === "online").length },
                { label: "LOS/Alerts (Luz Roja)", value: onus.filter(o => ["los", "power fail"].includes(o.status?.toLowerCase() || "")).length },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6">
                  <span className="block text-[10px] uppercase tracking-widest font-bold opacity-40 mb-1">{stat.label}</span>
                  <span className="text-4xl font-mono tracking-tighter">{stat.value}</span>
                </div>
              ))}
              
              <div className="bg-white p-6 flex flex-col justify-center">
                <span className="block text-[10px] uppercase tracking-widest font-bold opacity-40 mb-1">
                  Puertos Caídos ({totallyFallen.length} / {totalPorts})
                </span>
                {totallyFallen.length === 0 ? (
                  <span className="text-4xl font-mono tracking-tighter text-[#141414]/20">0</span>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[60px] overflow-y-auto pr-2 custom-scrollbar">
                    {totallyFallen.map((p, i) => {
                      const portKey = `${p.olt_id}-${p.board}-${p.port}`;
                      return (
                        <span 
                          key={i} 
                          className="text-xs font-mono font-bold text-rose-500 whitespace-nowrap cursor-pointer hover:underline"
                          onClick={() => setExpandedPort(portKey)}
                        >
                          {getOltName(p.olt_id)} - B{p.board} - P{p.port}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Critical Monitoring Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* Add Form */}
          <div className="lg:col-span-1 bg-white border border-[#141414]/10 p-6 shadow-sm">
            <h3 className="text-sm font-serif italic mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Nueva Alerta Especial
            </h3>
            <form onSubmit={addSpecialOnu} className="space-y-4">
              <div>
                <label className="block text-[9px] uppercase font-bold tracking-widest opacity-40 mb-1">SN / Serial Number</label>
                <input 
                  type="text" 
                  value={newSpecialSN}
                  onChange={(e) => setNewSpecialSN(e.target.value.toUpperCase())}
                  placeholder="Ej: ZTEGC1234567"
                  className="w-full bg-slate-50 border border-[#141414]/10 px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#141414] transition-colors rounded-sm"
                  required
                />
              </div>

              {specialError && (
                <div className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3 h-3" />
                  {specialError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[9px] uppercase font-bold tracking-widest opacity-40 mb-2">Triggers de Alerta</label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={specialAlertConfig.los}
                    onChange={(e) => setSpecialAlertConfig({...specialAlertConfig, los: e.target.checked})}
                    className="w-3 h-3 accent-[#141414]"
                  />
                  <span className="text-[10px] uppercase font-bold tracking-wide group-hover:opacity-70 transition-opacity">LOS (Red Light)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={specialAlertConfig.power}
                    onChange={(e) => setSpecialAlertConfig({...specialAlertConfig, power: e.target.checked})}
                    className="w-3 h-3 accent-[#141414]"
                  />
                  <span className="text-[10px] uppercase font-bold tracking-wide group-hover:opacity-70 transition-opacity">Power Fail</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={specialAlertConfig.offline}
                    onChange={(e) => setSpecialAlertConfig({...specialAlertConfig, offline: e.target.checked})}
                    className="w-3 h-3 accent-[#141414]"
                  />
                  <span className="text-[10px] uppercase font-bold tracking-wide group-hover:opacity-70 transition-opacity">Offline (General)</span>
                </label>
              </div>
              <button 
                type="submit"
                disabled={addingSpecial || !newSpecialSN}
                className="w-full bg-[#141414] text-[#E4E3E0] py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-20 rounded-sm"
              >
                {addingSpecial ? "Agregando..." : "Activar Monitoreo"}
              </button>
            </form>
          </div>

          {/* List */}
          <div className="lg:col-span-2 bg-white border border-[#141414]/10 shadow-sm flex flex-col">
            <div className="px-6 py-3 border-b border-[#141414]/5 bg-slate-50 flex justify-between items-center">
              <h3 className="text-xs uppercase font-black tracking-widest">Monitoreo Crítico Individual</h3>
              <span className="text-[9px] font-mono opacity-40">{specialOnus.length} ONUs activas</span>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[300px] custom-scrollbar">
              {specialOnus.length === 0 ? (
                <div className="h-full flex flex-center flex-col items-center justify-center p-12 opacity-20 italic">
                  <Info className="w-8 h-8 mb-2" />
                  <p className="text-xs italic">No hay ONUs en monitoreo especial.</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white shadow-sm">
                    <tr className="text-[9px] uppercase font-bold opacity-40 border-b border-[#141414]/5">
                      <th className="px-6 py-3">Nombre / SN</th>
                      <th className="px-6 py-3">Estado Actual</th>
                      <th className="px-6 py-3">Reglas</th>
                      <th className="px-6 py-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/5">
                    {specialOnus.map((s, i) => {
                      const cached = onus.find(o => o.sn === s.sn);
                      return (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold mb-0.5">{s.name}</div>
                            <div className="font-mono text-[10px] text-blue-500">{s.sn}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-2 h-2 rounded-full",
                                cached?.status?.toLowerCase() === 'online' ? "bg-emerald-500" : "bg-rose-500 animate-pulse"
                              )} />
                              <span className="font-mono uppercase text-[10px] font-bold">
                                {cached?.status || "Unknown"}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-1">
                              {s.alert_on_los === 1 && <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-600 rounded text-[8px] font-bold">LOS</span>}
                              {s.alert_on_power_fail === 1 && <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-600 rounded text-[8px] font-bold">PWR</span>}
                              {s.alert_on_offline === 1 && <span className="px-1.5 py-0.5 bg-slate-500/10 text-slate-600 rounded text-[8px] font-bold">OFF</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => removeSpecialOnu(s.sn)}
                              className="text-rose-500 hover:text-rose-700 p-1 transition-colors"
                              title="Eliminar Monitoreo"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        
        {/* PON Status Section */}
        {(() => {
          const allPortsStatus = ponOutages;
          const filteredPonStatus = allPortsStatus.filter(p => {
             if (selectedOltFilter !== 'all' && String(p.olt_id) !== selectedOltFilter) return false;
             if (selectedBoardFilter !== 'all' && String(p.board) !== selectedBoardFilter) return false;
             if (selectedPortFilter !== 'all' && String(p.port) !== selectedPortFilter) return false;
             return true;
          });
          const availableBoards = Array.from(new Set(allPortsStatus.filter(p => selectedOltFilter === 'all' || String(p.olt_id) === selectedOltFilter).map(p => String(p.board)))).sort((a: string, b: string) => parseInt(a, 10) - parseInt(b, 10));
          const availablePorts = Array.from(new Set(allPortsStatus.filter(p => 
            (selectedOltFilter === 'all' || String(p.olt_id) === selectedOltFilter) &&
            (selectedBoardFilter === 'all' || String(p.board) === selectedBoardFilter)
          ).map(p => String(p.port)))).sort((a: string, b: string) => parseInt(a, 10) - parseInt(b, 10));

          // Only show the table if there is at least one port OR an active filter is applied
          const hasFilters = selectedOltFilter !== 'all' || selectedBoardFilter !== 'all' || selectedPortFilter !== 'all';
          const portsToShow = hasFilters 
            ? filteredPonStatus 
            : filteredPonStatus.filter(p => p.los > 0 || p.power > 0);

          if (allPortsStatus.length === 0) return null;

          return (
            <div className="mb-8 border border-[#141414] bg-white overflow-hidden shadow-sm">
              <div className="bg-[#141414] text-[#E4E3E0] px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    <h2 className="text-xs uppercase tracking-widest font-bold">PON Status</h2>
                  </div>
                  
                  {olts.length > 0 && (
                    <div className="flex items-center gap-3">
                      <select 
                        className="bg-transparent text-xs font-mono border-b border-[#E4E3E0]/30 outline-none pb-1 cursor-pointer hover:border-[#E4E3E0]/70 transition-colors"
                        value={selectedOltFilter}
                        onChange={(e) => {
                          setSelectedOltFilter(e.target.value);
                          setSelectedBoardFilter('all');
                          setSelectedPortFilter('all');
                          setOutagePage(1);
                        }}
                      >
                        <option value="all" className="bg-[#141414]">All OLTs</option>
                        {olts.map(o => (
                          <option key={o.id || o.olt_id} value={String(o.id || o.olt_id)} className="bg-[#141414]">
                            {o.name || o.olt_name || `OLT ${o.id || o.olt_id}`}
                          </option>
                        ))}
                      </select>
                      
                      {availableBoards.length > 0 && (
                        <select 
                          className="bg-transparent text-xs font-mono border-b border-[#E4E3E0]/30 outline-none pb-1 cursor-pointer hover:border-[#E4E3E0]/70 transition-colors"
                          value={selectedBoardFilter}
                          onChange={(e) => {
                            setSelectedBoardFilter(e.target.value);
                            setSelectedPortFilter('all');
                            setOutagePage(1);
                          }}
                        >
                          <option value="all" className="bg-[#141414]">All Boards</option>
                          {availableBoards.map(b => (
                            <option key={b} value={b} className="bg-[#141414]">Board {b}</option>
                          ))}
                        </select>
                      )}

                      {availablePorts.length > 0 && (
                        <select 
                          className="bg-transparent text-xs font-mono border-b border-[#E4E3E0]/30 outline-none pb-1 cursor-pointer hover:border-[#E4E3E0]/70 transition-colors"
                          value={selectedPortFilter}
                          onChange={(e) => {
                            setSelectedPortFilter(e.target.value);
                            setOutagePage(1);
                          }}
                        >
                          <option value="all" className="bg-[#141414]">All Ports</option>
                          {availablePorts.map(p => (
                            <option key={p} value={p} className="bg-[#141414]">Port {p}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-mono opacity-50">{portsToShow.length} Port(s) displayed</span>
                  {portsToShow.length > 10 && (
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <button 
                        onClick={() => setOutagePage(Math.max(1, outagePage - 1))}
                        disabled={outagePage === 1}
                        className="px-2 py-1 bg-white/10 border border-white/20 rounded disabled:opacity-30 hover:bg-white/20 cursor-pointer"
                      >{'<'}</button>
                      <span>
                          {(outagePage - 1) * 10 + 1}-{Math.min(outagePage * 10, portsToShow.length)} of {portsToShow.length}
                      </span>
                      <button 
                        onClick={() => setOutagePage(Math.min(Math.ceil(portsToShow.length / 10), outagePage + 1))}
                        disabled={outagePage >= Math.ceil(portsToShow.length / 10)}
                        className="px-2 py-1 bg-white/10 border border-white/20 rounded disabled:opacity-30 hover:bg-white/20 cursor-pointer"
                      >{'>'}</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#141414]/10 bg-slate-50">
                    <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold opacity-40">OLT Name</th>
                    <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold opacity-40">Board/Port</th>
                    <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold opacity-40 text-center">Affected ONUs</th>
                    <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold opacity-40">Possible Cause</th>
                    <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold opacity-40">Status Since</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {portsToShow.slice((outagePage - 1) * 10, outagePage * 10).map((p, i) => {
                    const portKey = `${p.olt_id}-${p.board}-${p.port}`;
                    const isExpanded = expandedPort === portKey;
                    
                    return (
                      <React.Fragment key={i}>
                        <tr className={cn("transition-colors", isExpanded ? "bg-[#141414]/5" : "hover:bg-[#141414]/5")}>
                          <td className="px-6 py-5 font-bold text-sm">{getOltName(p.olt_id)}</td>
                          <td className="px-6 py-5">
                            <span 
                              className="text-blue-600 underline font-mono text-sm cursor-pointer hover:text-blue-800"
                              onClick={() => {
                                setExpandedPort(isExpanded ? null : portKey);
                              }}
                            >
                              B{p.board} / P{p.port}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-center font-mono text-sm font-bold">
                            <span className={cn(p.los > 0 ? "text-rose-500" : "text-emerald-500")}>
                                {p.los}
                            </span> 
                            <span className="text-[#141414]/40 font-normal text-xs"> of {p.total_onus}</span>
                          </td>
                          <td className="px-6 py-5">
                            {p.los > 0 ? (
                              <span className="px-3 py-1 bg-rose-500/10 text-rose-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-rose-500/20">
                                {p.cause}
                              </span>
                            ) : (
                              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider rounded-full border border-emerald-500/20">
                                Operational
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-5 text-xs opacity-60 font-mono">{p.los > 0 ? p.since : "Steady"}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}
        
        {ponOutages.length === 0 && !loading && subdomain && apiKey && (
          <div className="mb-8 p-12 bg-white border border-[#141414]/10 text-center rounded-sm">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <Wifi className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif italic mb-2 tracking-tight">All PON Ports Operational</h2>
            <p className="text-sm opacity-40 max-w-sm mx-auto">
              No mass outages or port failures detected across your OLT network at this time.
            </p>
          </div>
        )}
        </>
        )}

        {/* Footer Info */}
        <footer className="mt-12 border-t border-[#141414]/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-30">SmartOLT API Integration v1.0</p>
            <div className="w-1 h-1 bg-[#141414]/20 rounded-full" />
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-30">Secure Token Auth</p>
          </div>
          <p className="text-[10px] uppercase tracking-widest font-bold opacity-30">© 2026 Systems Engineering</p>
        </footer>
      </main>
    </div>
  );
}
