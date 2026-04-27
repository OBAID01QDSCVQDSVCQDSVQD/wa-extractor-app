'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';

interface Lead {
    id: string;
    name: string;
    number: string;
    source: string;
    timestamp: number;
}

export default function Home() {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [fromDate, setFromDate] = useState<string>('');
    const [toDate, setToDate] = useState<string>('');
    const [showUnsaved, setShowUnsaved] = useState<boolean>(false);
    const [countryPrefix, setCountryPrefix] = useState<string>('');
    const [smsMessage, setSmsMessage] = useState<string>('');
    const [sendingSms, setSendingSms] = useState<boolean>(false);
    const [loading, setLoading] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [activeTab, setActiveTab] = useState<'leads' | 'sms'>('leads');

    const filteredLeads = leads.filter(lead => {
        if (showUnsaved) {
            const isSaved = lead.name !== 'Unknown' && !lead.name.startsWith('+');
            if (isSaved) return false;
        }
        if (countryPrefix && !lead.number.startsWith(countryPrefix)) return false;
        if (!fromDate && !toDate) return true;
        if (lead.timestamp === 0) return !fromDate && !toDate;
        
        const leadDate = new Date(lead.timestamp);
        const start = fromDate ? new Date(fromDate) : null;
        const end = toDate ? new Date(toDate) : null;
        
        if (start && leadDate < start) return false;
        if (end) {
            const endOfDay = new Date(end);
            endOfDay.setHours(23, 59, 59, 999);
            if (leadDate > endOfDay) return false;
        }
        return true;
    });

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/wa?action=status');
            const data = await res.json();
            setStatus(data.status);
            setQrCode(data.qrCode);
        } catch (err) {
            console.error('Failed to fetch status', err);
        }
    }, []);

    useEffect(() => {
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

    const handleConnect = async () => {
        setLoading(true);
        try {
            await fetch('/api/wa?action=connect');
            await fetchStatus();
        } catch (err) {
            alert('Failed to start connection');
        } finally {
            setLoading(false);
        }
    };

    const handleExtract = async () => {
        setExtracting(true);
        try {
            const res = await fetch('/api/wa?action=extract');
            const data = await res.json();
            if (data.success) {
                setLeads(data.leads);
            } else {
                alert(data.error || 'Extraction failed');
            }
        } catch (err) {
            alert('Failed to extract leads');
        } finally {
            setExtracting(false);
        }
    };

    const handleLogout = async () => {
        if (!confirm('Are you sure you want to logout?')) return;
        try {
            await fetch('/api/wa?action=logout');
            setLeads([]);
            await fetchStatus();
        } catch (err) {
            alert('Failed to logout');
        }
    };

    const downloadCSV = () => {
        const headers = ['Name', 'Number', 'Source', 'Date'];
        const rows = filteredLeads.map(l => [
            l.name, 
            l.number, 
            l.source, 
            l.timestamp > 0 ? new Date(l.timestamp).toLocaleDateString() : 'N/A'
        ]);
        const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `wa_leads_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const sendSMS = async () => {
        if (!smsMessage) return alert('Please enter a message');
        if (filteredLeads.length === 0) return alert('No numbers to send to');
        if (!confirm(`Send this SMS to ${filteredLeads.length} numbers?`)) return;

        setSendingSms(true);
        try {
            const res = await fetch('/api/sms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    numbers: filteredLeads.map(l => l.number),
                    message: smsMessage
                })
            });
            const data = await res.json();
            if (data.success) {
                alert('SMS Campaign started successfully!');
                setSmsMessage('');
            } else {
                alert('Failed to send SMS: ' + data.error);
            }
        } catch (err) {
            alert('Error sending SMS');
        } finally {
            setSendingSms(false);
        }
    };

    return (
        <main className="min-h-screen bg-[#f8fafc] text-slate-700 font-sans selection:bg-emerald-500/20">
            <div className="relative flex h-screen overflow-hidden">
                
                {/* Sidebar */}
                <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm">
                    <div className="p-8 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </div>
                            <div>
                                <h1 className="text-xl font-black tracking-tighter text-slate-900">SDK EXTRACTOR</h1>
                                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">WhatsApp Engine v2.0</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 p-6 space-y-8 overflow-y-auto">
                        {/* Status Widget */}
                        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Status</span>
                                <div className={`flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-black border ${
                                    status === 'connected' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                    status === 'connecting' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                    'bg-red-50 text-red-600 border-red-100'
                                }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-current'}`}></span>
                                    {status.toUpperCase()}
                                </div>
                            </div>
                            
                            {status === 'disconnected' && (
                                <button 
                                    onClick={handleConnect}
                                    disabled={loading}
                                    className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-md text-sm"
                                >
                                    {loading ? 'INITIALIZING...' : 'CONNECT WHATSAPP'}
                                </button>
                            )}

                            {status === 'connecting' && qrCode && (
                                <div className="bg-white p-3 rounded-xl border border-slate-200">
                                    <Image src={qrCode} alt="QR" width={200} height={200} className="w-full h-auto" />
                                    <p className="text-[10px] text-slate-400 mt-2 text-center italic">Scan to link device</p>
                                </div>
                            )}

                            {status === 'connected' && (
                                <div className="space-y-3">
                                    <button 
                                        onClick={handleExtract}
                                        disabled={extracting}
                                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                                    >
                                        {extracting ? 'EXTRACTING...' : 'SYNC LEADS'}
                                    </button>
                                    <button 
                                        onClick={handleLogout}
                                        className="w-full py-2 text-xs text-red-500 hover:text-red-600 font-bold transition-all"
                                    >
                                        DISCONNECT
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Navigation */}
                        <nav className="space-y-1">
                            <button 
                                onClick={() => setActiveTab('leads')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm ${activeTab === 'leads' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                Leads Manager
                            </button>
                            <button 
                                onClick={() => setActiveTab('sms')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-bold text-sm ${activeTab === 'sms' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                SMS Campaign
                            </button>
                        </nav>

                        {/* Filters in Sidebar */}
                        <div className="pt-4 border-t border-slate-100 space-y-4">
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Filters</span>
                            
                            <div className="space-y-3">
                                <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer group">
                                    <span className="text-xs text-slate-500 group-hover:text-slate-900 transition-colors">Unsaved Only</span>
                                    <input 
                                        type="checkbox" 
                                        checked={showUnsaved}
                                        onChange={(e) => setShowUnsaved(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 bg-white text-emerald-500 focus:ring-emerald-500"
                                    />
                                </label>

                                <div className="space-y-1">
                                    <span className="text-[10px] text-slate-400 font-bold ml-1">COUNTRY PREFIX</span>
                                    <input 
                                        type="text" 
                                        placeholder="e.g. 216"
                                        value={countryPrefix}
                                        onChange={(e) => setCountryPrefix(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-emerald-600 outline-none focus:border-emerald-500/30"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    
                    {/* Top Bar */}
                    <header className="h-20 border-b border-slate-200 bg-white flex items-center justify-between px-10">
                        <div className="flex items-center gap-4">
                            <h2 className="text-lg font-bold text-slate-900">
                                {activeTab === 'leads' ? 'Extracted Contacts' : 'SMS Campaign'}
                            </h2>
                            <span className="bg-emerald-100 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-md">
                                {filteredLeads.length} RESULTS
                            </span>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1 border border-slate-200">
                                <input 
                                    type="date" 
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="bg-transparent text-[10px] text-slate-600 outline-none p-2 cursor-pointer font-bold"
                                />
                                <span className="text-slate-300 text-xs">→</span>
                                <input 
                                    type="date" 
                                    value={toDate}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className="bg-transparent text-[10px] text-slate-600 outline-none p-2 cursor-pointer font-bold"
                                />
                            </div>
                            
                            {leads.length > 0 && (activeTab === 'leads') && (
                                <button 
                                    onClick={downloadCSV}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all shadow-md"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    EXPORT CSV
                                </button>
                            )}
                        </div>
                    </header>

                    {/* Content View */}
                    <div className="flex-1 overflow-y-auto p-10 bg-slate-50/50">
                        
                        {activeTab === 'leads' ? (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-6xl mx-auto">
                                {filteredLeads.length > 0 ? (
                                    filteredLeads.map((lead, i) => (
                                        <div key={i} className="group bg-white hover:bg-slate-50 border border-slate-200 hover:border-emerald-500/30 rounded-2xl p-6 transition-all flex items-center justify-between shadow-sm hover:shadow-md">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-all font-black">
                                                    {lead.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-900 group-hover:text-emerald-600 transition-all">{lead.name === 'Unknown' ? lead.number : lead.name}</h3>
                                                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">{lead.source}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-mono text-slate-900 font-bold">+{lead.number}</p>
                                                {lead.timestamp > 0 && (
                                                    <p className="text-[9px] text-slate-400 mt-1">Active: {new Date(lead.timestamp).toLocaleDateString()}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="col-span-full h-96 flex flex-col items-center justify-center text-center opacity-40">
                                        <div className="w-20 h-20 bg-slate-200 rounded-3xl flex items-center justify-center mb-6">
                                            <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0V9a2 2 0 00-2-2H6a2 2 0 00-2 2v2m4.688 4.406A4.988 4.988 0 0012 15a4.988 4.988 0 004.312 2.406m-8.624 0A4.988 4.988 0 0112 15m0 0a4.988 4.988 0 014.312 2.406m-8.624 0h8.624" />
                                            </svg>
                                        </div>
                                        <h3 className="text-xl font-bold text-slate-900">No Leads Found</h3>
                                        <p className="text-sm text-slate-500 max-w-xs mx-auto mt-2">Connect your WhatsApp and click Sync Leads to start extracting numbers.</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto">
                                <div className="bg-white border border-slate-200 rounded-3xl p-10 space-y-8 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-100">
                                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-slate-900">Create SMS Campaign</h2>
                                            <p className="text-slate-500 text-sm">Broadcasting to {filteredLeads.length} recipients based on your filters.</p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Message Content</label>
                                        <textarea 
                                            value={smsMessage}
                                            onChange={(e) => setSmsMessage(e.target.value)}
                                            placeholder="Example: Hello from SDK Bâtiment! We have a special offer for you..."
                                            className="w-full h-48 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-slate-900 placeholder:text-slate-300 focus:border-emerald-500/30 outline-none transition-all resize-none shadow-inner"
                                        />
                                        <div className="flex justify-between px-2 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                            <span>{smsMessage.length} Characters</span>
                                            <span>{Math.ceil(smsMessage.length / 160)} SMS Credits / Contact</span>
                                        </div>
                                    </div>

                                    <button 
                                        onClick={sendSMS}
                                        disabled={sendingSms || filteredLeads.length === 0 || !smsMessage}
                                        className="w-full py-5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 text-white font-black rounded-2xl transition-all shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-3 text-lg tracking-tight"
                                    >
                                        {sendingSms ? (
                                            <>
                                                <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                SENDING CAMPAIGN...
                                            </>
                                        ) : (
                                            <>
                                                LAUNCH CAMPAIGN TO {filteredLeads.length} RECIPIENTS
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                                </svg>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
