'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';

interface Lead {
    id: string;
    name: string;
    number: string;
    source: string;
}

export default function Home() {
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(false);
    const [extracting, setExtracting] = useState(false);

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

    const copyToClipboard = () => {
        const text = leads.map(l => `${l.name}\t${l.number}`).join('\n');
        navigator.clipboard.writeText(text);
        alert('Copied to clipboard!');
    };

    return (
        <main className="min-h-screen bg-[#0f172a] text-white p-4 md:p-8 font-sans">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6 bg-[#1e293b]/50 p-8 rounded-3xl border border-white/10 backdrop-blur-xl">
                    <div>
                        <h1 className="text-4xl font-black bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                            WA Lead Extractor
                        </h1>
                        <p className="text-slate-400 text-lg">
                            Extract contacts and group participants for your SMS campaigns.
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 border ${
                            status === 'connected' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            status === 'connecting' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-slate-500/10 text-slate-400 border-slate-500/20'
                        }`}>
                            <span className={`w-2 h-2 rounded-full animate-pulse ${
                                status === 'connected' ? 'bg-emerald-400' :
                                status === 'connecting' ? 'bg-amber-400' :
                                'bg-slate-400'
                            }`}></span>
                            {status.toUpperCase()}
                        </div>
                        
                        {status === 'connected' && (
                            <button 
                                onClick={handleLogout}
                                className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-sm font-bold hover:bg-red-500 hover:text-white transition-all"
                            >
                                LOGOUT
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Control Panel */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-[#1e293b]/50 p-6 rounded-3xl border border-white/10 backdrop-blur-xl h-full flex flex-col justify-center items-center text-center">
                            {status === 'disconnected' && (
                                <>
                                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-500/30">
                                        <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                    </div>
                                    <h2 className="text-xl font-bold mb-4">Connect WhatsApp</h2>
                                    <p className="text-slate-400 mb-8 text-sm">Scan the QR code with your phone to start extracting leads.</p>
                                    <button 
                                        onClick={handleConnect}
                                        disabled={loading}
                                        className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#0f172a] font-black rounded-2xl transition-all shadow-lg shadow-emerald-500/20"
                                    >
                                        {loading ? 'INITIALIZING...' : 'GENERATE QR CODE'}
                                    </button>
                                </>
                            )}

                            {status === 'connecting' && (
                                <>
                                    <h2 className="text-xl font-bold mb-6">Scan QR Code</h2>
                                    {qrCode ? (
                                        <div className="bg-white p-4 rounded-2xl mb-6 shadow-2xl">
                                            <Image src={qrCode} alt="QR Code" width={256} height={256} className="w-full h-auto" />
                                        </div>
                                    ) : (
                                        <div className="w-64 h-64 bg-white/5 animate-pulse rounded-2xl mb-6 flex items-center justify-center border border-white/10">
                                            <p className="text-slate-500 text-sm">Generating QR...</p>
                                        </div>
                                    )}
                                    <p className="text-slate-400 text-xs italic">Open WhatsApp &gt; Menu &gt; Linked Devices</p>
                                </>
                            )}

                            {status === 'connected' && (
                                <>
                                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-500/30">
                                        <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <h2 className="text-xl font-bold mb-2">Successfully Connected!</h2>
                                    <p className="text-slate-400 mb-8 text-sm">You are now ready to extract your leads.</p>
                                    <button 
                                        onClick={handleExtract}
                                        disabled={extracting}
                                        className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#0f172a] font-black rounded-2xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                                    >
                                        {extracting ? (
                                            <>
                                                <svg className="animate-spin h-5 w-5 text-[#0f172a]" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                EXTRACTING...
                                            </>
                                        ) : 'START EXTRACTION'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Results Area */}
                    <div className="lg:col-span-2">
                        <div className="bg-[#1e293b]/50 rounded-3xl border border-white/10 backdrop-blur-xl h-full flex flex-col overflow-hidden">
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                                <h2 className="font-bold text-xl flex items-center gap-2">
                                    <span className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-400 text-sm">
                                        {leads.length}
                                    </span>
                                    Extracted Leads
                                </h2>
                                {leads.length > 0 && (
                                    <button 
                                        onClick={copyToClipboard}
                                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-all flex items-center gap-2"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                        </svg>
                                        COPY ALL
                                    </button>
                                )}
                            </div>
                            
                            <div className="flex-1 overflow-auto max-h-[600px] p-2">
                                {leads.length > 0 ? (
                                    <table className="w-full text-left border-separate border-spacing-y-2">
                                        <thead>
                                            <tr className="text-slate-500 text-xs uppercase tracking-wider">
                                                <th className="px-4 py-2">Name</th>
                                                <th className="px-4 py-2">Number</th>
                                                <th className="px-4 py-2">Source</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {leads.map((lead, i) => (
                                                <tr key={i} className="bg-white/5 hover:bg-white/10 transition-colors rounded-xl overflow-hidden group">
                                                    <td className="px-4 py-4 font-bold rounded-l-xl text-emerald-400">{lead.name}</td>
                                                    <td className="px-4 py-4 text-slate-300 font-mono">{lead.number}</td>
                                                    <td className="px-4 py-4 text-slate-500 text-xs truncate max-w-[200px] rounded-r-xl">{lead.source}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                                        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4 text-slate-600">
                                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.58 4 8 4s8-1.79 8-4M4 7c0-2.21 3.58-4 8-4s8 1.79 8 4m0 5c0 2.21-3.58 4-8 4s-8-1.79-8-4" />
                                            </svg>
                                        </div>
                                        <p className="text-slate-500 italic">No leads extracted yet. Connect and start extraction.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer / Instructions */}
                <div className="mt-12 text-center text-slate-500 text-sm">
                    <p>Designed for SDK Bâtiment • Built with Next.js & Baileys</p>
                </div>
            </div>
        </main>
    );
}
