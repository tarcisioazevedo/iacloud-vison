import useSWR from "swr";
import { ReviewSummary } from "@/types/review";
import { Event } from "@/types/event";
import { useMemo, useState } from "react";
import {
    LuActivity,
    LuCamera,
    LuEye,
} from "react-icons/lu";
import { FaExclamationTriangle, FaCheckCircle } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { baseUrl } from "@/api/baseUrl";
import { formatUnixTimestampToDateTime } from "@/utils/dateUtil";
import Chart from "react-apexcharts";

// Local basic modal for drill-down
function EventModal({ event, onClose }: { event: Event; onClose: () => void }) {
    if (!event) return null;

    const description = event.data?.description;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = event.data?.metadata as Record<string, any> | undefined;
    const threatLevel = metadata?.potential_threat_level;
    const reviewTitle = metadata?.title;
    const reviewScene = metadata?.scene;

    const threatConfig: Record<number, { label: string; color: string; bg: string }> = {
        0: { label: "Normal", color: "text-green-400", bg: "bg-green-500/10" },
        1: { label: "Atenção", color: "text-yellow-400", bg: "bg-yellow-500/10" },
        2: { label: "Crítico", color: "text-red-400", bg: "bg-red-500/10" },
    };
    const threat = typeof threatLevel === "number" ? threatConfig[threatLevel] : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-secondary-highlight bg-background shadow-2xl">
                <div className="flex items-center justify-between border-b border-secondary-highlight bg-secondary px-6 py-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-primary">
                            Detalhes do Evento
                        </h2>
                        {threat && (
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${threat.color} ${threat.bg}`}>
                                <span className={`size-2 rounded-full ${threatLevel === 0 ? 'bg-green-400' : threatLevel === 1 ? 'bg-yellow-400' : 'bg-red-400'}`} />
                                {threat.label}
                            </span>
                        )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Fechar
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                        <img
                            src={`${baseUrl}api/events/${event.id}/thumbnail.jpg`}
                            alt="Thumbnail"
                            className="h-full w-full object-contain"
                        />
                    </div>

                    {/* GenAI Description — most impactful feature */}
                    {(description || reviewScene) && (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
                                <LuActivity className="h-3.5 w-3.5" />
                                Análise de IA
                            </div>
                            {reviewTitle && (
                                <p className="mb-1 font-semibold text-primary">{reviewTitle}</p>
                            )}
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                {description || reviewScene}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="rounded-lg bg-secondary p-4">
                            <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Câmera</div>
                            <div className="font-medium">{event.camera}</div>
                        </div>
                        <div className="rounded-lg bg-secondary p-4">
                            <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Rótulo</div>
                            <div className="font-medium capitalize">{event.label} {event.sub_label ? `(${event.sub_label})` : ""}</div>
                        </div>
                        <div className="rounded-lg bg-secondary p-4">
                            <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Momento</div>
                            <div className="font-medium">{formatUnixTimestampToDateTime(event.start_time, { date_style: "medium", time_style: "medium" })}</div>
                        </div>
                        <div className="rounded-lg bg-secondary p-4">
                            <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Confiança</div>
                            <div className="font-medium">{Math.round(event.data.top_score * 100)}%</div>
                        </div>
                        <div className="col-span-2 rounded-lg bg-secondary p-4">
                            <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Zonas Ativadas</div>
                            <div className="font-medium">{event.zones.length > 0 ? event.zones.join(", ") : "Nenhuma zona especificada"}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Cockpit() {
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

    // Fetch KPI data
    const { data: reviewSummary } = useSWR<ReviewSummary>("review/summary", {
        revalidateOnFocus: true,
    });

    // Fetch Latest Events (Drill Down)
    const { data: events, isLoading: eventsLoading } = useSWR<Event[]>("events?limit=25", {
        revalidateOnFocus: true,
    });

    // Fetch Events Summary for Pie Chart
    const { data: eventsSummary } = useSWR<any[]>("events/summary", {
        revalidateOnFocus: true,
    });

    const kpis = useMemo(() => {
        let totalAlert = 0;
        let totalDetection = 0;
        let reviewedAlert = 0;
        let reviewedDetection = 0;

        if (reviewSummary) {
            Object.values(reviewSummary).forEach((day) => {
                totalAlert += day.total_alert || 0;
                totalDetection += day.total_detection || 0;
                reviewedAlert += day.reviewed_alert || 0;
                reviewedDetection += day.reviewed_detection || 0;
            });
        }

        const unreviewedAlerts = totalAlert - reviewedAlert;
        const reviewRate = totalAlert + totalDetection > 0
            ? Math.round(((reviewedAlert + reviewedDetection) / (totalAlert + totalDetection)) * 100)
            : 0;

        return {
            totalAlert,
            totalDetection,
            unreviewedAlerts,
            reviewRate
        };
    }, [reviewSummary]);

    // Transform Data for Line Chart
    const lineChartData = useMemo(() => {
        if (!reviewSummary) return { options: {}, series: [] };

        // Sort days
        const sortedDays = Object.keys(reviewSummary).sort();

        const categories = sortedDays.map(d => d.slice(5)); // just MM-DD
        const totalAlerts = sortedDays.map(day => reviewSummary[day].total_alert || 0);
        const totalDetections = sortedDays.map(day => reviewSummary[day].total_detection || 0);

        return {
            options: {
                chart: { type: "area" as const, toolbar: { show: false }, background: "transparent" },
                colors: ["#ea580c", "#3b82f6"],
                dataLabels: { enabled: false },
                stroke: { curve: "smooth" as const, width: 2 },
                xaxis: { categories, labels: { style: { colors: "#888" } } },
                yaxis: { labels: { style: { colors: "#888" } } },
                theme: { mode: "dark" as const },
                grid: { borderColor: "#333", strokeDashArray: 4 },
            },
            series: [
                { name: "Alertas", data: totalAlerts },
                { name: "Detecções", data: totalDetections }
            ]
        };
    }, [reviewSummary]);

    // Transform Data for Pie Chart
    const pieChartData = useMemo(() => {
        if (!eventsSummary) return { options: {}, series: [] };

        const labelCounts: Record<string, number> = {};
        eventsSummary.forEach(evt => {
            labelCounts[evt.label] = (labelCounts[evt.label] || 0) + evt.count;
        });

        const labels = Object.keys(labelCounts).sort((a, b) => labelCounts[b] - labelCounts[a]).slice(0, 5);
        const series = labels.map(l => labelCounts[l]);

        return {
            options: {
                chart: { type: "donut" as const, background: "transparent" },
                labels: labels,
                theme: { mode: "dark" as const },
                stroke: { show: false },
                dataLabels: { enabled: false },
                legend: { position: "bottom" as const, labels: { colors: "#888" } },
            },
            series
        };
    }, [eventsSummary]);

    return (
        <div className="flex size-full flex-col overflow-hidden bg-background">
            <div className="flex h-14 items-center justify-between border-b border-secondary-highlight px-6">
                <h1 className="text-xl font-bold tracking-tight">Cockpit de Gestão</h1>
                <div className="flex h-full items-center">
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                        Monitoramento Ativo
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <div className="flex items-center justify-between pb-2">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Alertas Totais</h3>
                            <FaExclamationTriangle className="h-4 w-4 text-orange-500" />
                        </div>
                        <div className="text-3xl font-bold text-primary">{kpis.totalAlert}</div>
                        <p className="mt-1 text-xs text-muted-foreground">Eventos de alta relevância</p>
                    </div>

                    <div className="flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <div className="flex items-center justify-between pb-2">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Detecções Totais</h3>
                            <LuActivity className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="text-3xl font-bold text-primary">{kpis.totalDetection}</div>
                        <p className="mt-1 text-xs text-muted-foreground">Movimento e reconhecimento base</p>
                    </div>

                    <div className="flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <div className="flex items-center justify-between pb-2">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Alertas Pendentes</h3>
                            <LuCamera className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="text-3xl font-bold text-primary">{kpis.unreviewedAlerts}</div>
                        <p className="mt-1 text-xs text-muted-foreground">Requerem sua atenção</p>
                    </div>

                    <div className="flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <div className="flex items-center justify-between pb-2">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Taxa de Revisão</h3>
                            <FaCheckCircle className="h-4 w-4 text-green-500" />
                        </div>
                        <div className="text-3xl font-bold text-primary">{kpis.reviewRate}%</div>
                        <p className="mt-1 text-xs text-muted-foreground">Produtividade operacional</p>
                    </div>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-primary mb-1">Tendência Temporal</h3>
                        <p className="text-sm text-muted-foreground mb-4">Volume de acionamentos diários baseados no sumário</p>
                        <div className="flex-1 w-full min-h-[250px]">
                            {lineChartData.series.length > 0 ? (
                                <Chart options={lineChartData.options} series={lineChartData.series} type="area" height="250" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground"><ActivityIndicator /></div>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col rounded-xl border border-secondary-highlight bg-card p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-primary mb-1">Top Objetos</h3>
                        <p className="text-sm text-muted-foreground mb-4">Distribuição primária da IA (todos os dias)</p>
                        <div className="flex-1 w-full flex items-center justify-center min-h-[250px]">
                            {pieChartData.series.length > 0 ? (
                                <Chart options={pieChartData.options} series={pieChartData.series} type="donut" height="280" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground"><ActivityIndicator /></div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Drill-Down Table */}
                <div className="flex flex-col overflow-hidden rounded-xl border border-secondary-highlight bg-card shadow-sm">
                    <div className="border-b border-secondary-highlight px-6 py-4 flex justify-between items-center bg-secondary/50">
                        <div>
                            <h2 className="text-lg font-semibold text-primary">Detalhamento de Eventos (Drill-Down)</h2>
                            <p className="text-sm text-muted-foreground">Lista de acionamentos recentes classificados por IA</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-secondary text-muted-foreground">
                                <tr>
                                    <th className="px-6 py-3 font-medium">Prévia</th>
                                    <th className="px-6 py-3 font-medium">Câmera</th>
                                    <th className="px-6 py-3 font-medium">Tipo / Objeto</th>
                                    <th className="px-6 py-3 font-medium">Data e Hora</th>
                                    <th className="px-6 py-3 font-medium">Score</th>
                                    <th className="px-6 py-3 font-medium text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-secondary-highlight">
                                {eventsLoading ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center">
                                            <ActivityIndicator className="mx-auto" />
                                        </td>
                                    </tr>
                                ) : events && events.length > 0 ? (
                                    events.map((evt) => (
                                        <tr key={evt.id} className="hover:bg-secondary/40 transition-colors">
                                            <td className="px-6 py-2">
                                                <img
                                                    src={`${baseUrl}api/events/${evt.id}/thumbnail.jpg`}
                                                    className="h-10 w-16 rounded object-cover shadow-sm"
                                                    alt="thumb"
                                                />
                                            </td>
                                            <td className="px-6 py-4 font-medium">{evt.camera}</td>
                                            <td className="px-6 py-4 capitalize">
                                                <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-500">
                                                    {evt.label}
                                                    {evt.sub_label && <span className="ml-1 opacity-75"> ({evt.sub_label})</span>}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                                                {formatUnixTimestampToDateTime(evt.start_time, { date_style: "medium", time_style: "medium" })}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${evt.data.top_score > 0.8 ? 'bg-green-500' : evt.data.top_score > 0.6 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                            style={{ width: `${evt.data.top_score * 100}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs">{Math.round(evt.data.top_score * 100)}%</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setSelectedEvent(evt)}
                                                >
                                                    <LuEye className="mr-2 h-4 w-4" /> Detalhar
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                            Nenhum evento registrado.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedEvent && (
                <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
            )}
        </div>
    );
}
