/**
 * Benchly AI Campus Companion (Gemma 4 12B over Ollama Cluster)
 * Automatically pairs a waiting EWU student when no real classmate is available
 * in the queue, conversing naturally in Bangla, English, and Banglish like a
 * real East West University student.
 *
 * Supports automatic round-robin + failover across:
 *   labpc, labpc25, labpc26, labpc31 (or custom OLLAMA_HOSTS in .env)
 */

import { generateServerNickname } from './nickname_engine';

export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AiRoomSession {
    roomId: string;
    aiUserId: string;
    aiAlias: string;
    aiDept: string;
    aiSemester: string;
    icebreaker: string;
    history: AiChatMessage[];
    isGenerating: boolean;
}

const DEFAULT_OLLAMA_HOSTS = [
    'https://labpc1.benchly.live',
    'https://labpc25.benchly.live',
    'https://labpc26.benchly.live',
    'https://labpc31.benchly.live',
    'http://100.110.58.116:11434',
    'http://127.0.0.1:11434'
];

const EWU_DEPTS = ['CSE', 'BBA', 'EEE', 'Pharmacy', 'English', 'Economics', 'Law'];
const EWU_SEMESTERS = ['3rd Sem', '4th Sem', '5th Sem', '6th Sem', '7th Sem', '8th Sem'];
const EWU_VIBES = [
    'just finished a long lab and craving Aftabnagar main gate cha',
    'chilling on the ground floor bench between classes',
    'hiding on Library Floor 4 pretending to study for midterms',
    'debating whether to get main gate fuchka or cafeteria khichuri',
    'surviving an 8:30 AM class on zero sleep'
];

export class AiCampusCompanionEngine {
    private static hosts: string[] = (() => {
        const raw = (process.env.OLLAMA_HOSTS || '').trim();
        if (!raw) return DEFAULT_OLLAMA_HOSTS;
        return raw
            .split(',')
            .map((h) => {
                const t = h.trim().replace(/\/+$/, '');
                if (!t) return '';
                if (t.startsWith('http://') || t.startsWith('https://')) return t;
                return t.includes(':') ? `http://${t}` : `http://${t}:11434`;
            })
            .filter(Boolean);
    })();

    private static modelName: string = (process.env.AI_BENCH_MODEL || 'gemma4:12b').trim();
    private static rrIndex = 0;
    private static lastWarmHost: string | null = null;
    private static totalCalls = 0;
    private static totalErrors = 0;
    private static totalLatencyMs = 0;
    private static lastLatencyMs = 0;

    static async checkClusterHealth() {
        const publicHosts = this.hosts.filter(
            (h) => h.startsWith('https://') || h.includes('100.') || h.includes('127.0.0.1')
        );
        const nodes = await Promise.all(
            publicHosts.map(async (host) => {
                const start = Date.now();
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 2500);
                try {
                    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
                    clearTimeout(timer);
                    const latencyMs = Date.now() - start;
                    if (!res.ok) {
                        return {
                            host,
                            label: host.replace(/^https?:\/\//, '').split('.')[0],
                            online: false,
                            latencyMs,
                            hasModel: false,
                            isWarmHost: host === this.lastWarmHost,
                            error: `HTTP ${res.status}`
                        };
                    }
                    const data: any = await res.json().catch(() => ({}));
                    const models: string[] = Array.isArray(data?.models)
                        ? data.models.map((m: any) => String(m?.name || m?.model || ''))
                        : [];
                    const hasModel = models.some((m) => m.includes(this.modelName) || m.includes('gemma4'));
                    return {
                        host,
                        label: host.replace(/^https?:\/\//, '').split('.')[0],
                        online: true,
                        latencyMs,
                        hasModel,
                        isWarmHost: host === this.lastWarmHost,
                        modelsCount: models.length
                    };
                } catch (err: any) {
                    clearTimeout(timer);
                    return {
                        host,
                        label: host.replace(/^https?:\/\//, '').split('.')[0],
                        online: false,
                        latencyMs: Date.now() - start,
                        hasModel: false,
                        isWarmHost: host === this.lastWarmHost,
                        error: err?.name === 'AbortError' ? 'Timeout (>2.5s)' : err?.message || 'Unreachable'
                    };
                }
            })
        );

        const avgLatencyMs =
            this.totalCalls > 0 ? Math.round(this.totalLatencyMs / this.totalCalls) : 0;

        return {
            modelName: this.modelName,
            lastWarmHost: this.lastWarmHost,
            stats: {
                totalCalls: this.totalCalls,
                totalErrors: this.totalErrors,
                avgLatencyMs,
                lastLatencyMs: this.lastLatencyMs
            },
            nodes
        };
    }

    static createSession(roomId: string, icebreaker: string, matchMode: string): AiRoomSession {
        const aiAlias = generateServerNickname();
        const aiDept = EWU_DEPTS[Math.floor(Math.random() * EWU_DEPTS.length)];
        const aiSemester = EWU_SEMESTERS[Math.floor(Math.random() * EWU_SEMESTERS.length)];
        const vibe = EWU_VIBES[Math.floor(Math.random() * EWU_VIBES.length)];

        const systemPrompt = [
            `You are "${aiAlias}", a friendly, witty university student at East West University (EWU) in Aftabnagar, Dhaka (${aiDept}, ${aiSemester}).`,
            `Right now you are ${vibe}. You are chatting anonymously 1-on-1 with a classmate on Benchly (mode: ${matchMode}).`,
            `The room's icebreaker prompt is: "${icebreaker}".`,
            `CRITICAL STYLE RULES:`,
            `1. Match the user's language naturally: if they write in Bangla (বাংলা), reply in casual natural Dhaka Bangla; if they write in Banglish (Romanized Bangla like "ki obostha", "bhai", "exam kemon"), reply in natural EWU Banglish; if they write in English, reply in casual friendly student English (light Dhaka slang like "bhai", "yaar", "adda", "cha" is fine).`,
            `2. Keep every reply SHORT like a real chat message: 1 to 2 sentences max (under 35 words). Never write essays or bullet lists.`,
            `3. Sound 100% like a genuine uni student — curious, relaxed, relatable, occasionally funny. Ask natural follow-up questions.`,
            `4. NEVER mention being an AI, LLM, bot, or Gemma. Never reveal fake phone numbers, emails, or social handles.`,
            `5. You know EWU Aftabnagar campus life: main gate tong-er cha, fuchka, ground floor benches, Library Floor 4, cafeteria, CSE/BBA/EEE midterms, and 8:30 AM classes.`
        ].join('\n');

        return {
            roomId,
            aiUserId: `ai_student_${roomId.slice(0, 8)}`,
            aiAlias,
            aiDept,
            aiSemester,
            icebreaker,
            history: [{ role: 'system', content: systemPrompt }],
            isGenerating: false
        };
    }

    static async generateOpeningLine(session: AiRoomSession): Promise<string> {
        const prompt =
            'Send a super short, casual first message (under 15 words) to break the ice with your EWU classmate on Benchly. You can mix light English/Banglish naturally.';
        return this.callOllamaWithFailover([...session.history, { role: 'user', content: prompt }], 'hey');
    }

    static async generateReply(session: AiRoomSession, userMessage: string): Promise<string> {
        session.history.push({ role: 'user', content: userMessage });
        // Keep context window compact (system + last 16 turns) for fast 12B responses
        if (session.history.length > 17) {
            session.history = [session.history[0], ...session.history.slice(-16)];
        }
        const t0 = Date.now();
        this.totalCalls += 1;
        try {
            const reply = await this.callOllamaWithFailover(session.history, userMessage);
            const elapsed = Date.now() - t0;
            this.lastLatencyMs = elapsed;
            this.totalLatencyMs += elapsed;
            session.history.push({ role: 'assistant', content: reply });
            return reply;
        } catch (err) {
            this.totalErrors += 1;
            throw err;
        }
    }

    private static async querySingleHost(
        host: string,
        messages: AiChatMessage[],
        timeoutMs: number
    ): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${host}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    model: this.modelName,
                    messages,
                    stream: false,
                    think: false,
                    keep_alive: '30m',
                    options: {
                        temperature: 0.85,
                        top_p: 0.9,
                        num_predict: 55,
                        num_ctx: 1024
                    }
                })
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: any = await res.json();
            const content = (data?.message?.content || '').toString().trim();
            if (!content) throw new Error('Empty reply');
            this.lastWarmHost = host;
            return content.replace(/^["']|["']$/g, '').slice(0, 320);
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    private static async callOllamaWithFailover(
        messages: AiChatMessage[],
        lastUserText: string
    ): Promise<string> {
        // Order hosts with the last warm VRAM host first for ~1-2s replies
        const ordered = this.lastWarmHost && this.hosts.includes(this.lastWarmHost)
            ? [this.lastWarmHost, ...this.hosts.filter((h) => h !== this.lastWarmHost)]
            : [...this.hosts.slice(this.rrIndex % this.hosts.length), ...this.hosts.slice(0, this.rrIndex % this.hosts.length)];
        this.rrIndex = (this.rrIndex + 1) % this.hosts.length;

        // 1. Fast path: hit warm host first (or race top 2 hosts concurrently if none warm yet)
        if (this.lastWarmHost) {
            try {
                return await this.querySingleHost(ordered[0], messages, 9000);
            } catch {
                this.lastWarmHost = null;
            }
        }

        // 2. Hedged parallel race across all lab hosts (first fast reply wins, 10s cap)
        const candidates = ordered.slice(0, 4);
        const firstFulfilled = <T>(promises: Promise<T>[]): Promise<T> =>
            new Promise<T>((resolve, reject) => {
                let remaining = promises.length;
                if (remaining === 0) return reject(new Error('No hosts'));
                for (const p of promises) {
                    p.then(resolve, () => {
                        remaining--;
                        if (remaining === 0) reject(new Error('All hosts failed'));
                    });
                }
            });
        try {
            return await firstFulfilled(candidates.map((h) => this.querySingleHost(h, messages, 10000)));
        } catch {
            // Graceful fallback if all labpc Ollama nodes are temporarily unreachable
            return this.fallbackStudentReply(lastUserText);
        }
    }

    private static fallbackStudentReply(userText: string): string {
        const hasBanglaScript = /[\u0980-\u09FF]/.test(userText);
        if (hasBanglaScript) {
            const bn = [
                'হা হা একদম ঠিক বলসো! তোমার কোন ডিপার্টমেন্ট?',
                'আরেহ ভাই, আজকে ক্যাম্পাসে চা খেতে গেসিলা নাকি লাইব্রেরিতে?',
                'মিডটার্মের চাপে তো অবস্থা খারাপ 😅 তোমার ক্লাস শেষ আজকে?'
            ];
            return bn[Math.floor(Math.random() * bn.length)];
        }
        const isBanglish = /\b(ki|kemon|bhai|bro|arre|obostha|kothay|tumi|ami|bhalo|valo|accho|korso|cha|adda)\b/i.test(
            userText
        );
        if (isBanglish) {
            const bng = [
                'arre bhai ekdom mood off, main gate er cha khaitesi haha. tomar ki obostha?',
                'haha true! btw tumi kon dept er? midterm prep kemon cholse?',
                'ki bolbo yaar, 8:30 er class kore ghum dhorse 😅 tomar ajke class shesh?'
            ];
            return bng[Math.floor(Math.random() * bng.length)];
        }
        const en = [
            'haha honestly same, campus feels extra busy today. what dept are you in?',
            'no way, I was literally just thinking about grabbing cha from the main gate 😅 how is your semester going?',
            'fair enough! surviving midterms or actually chilling between classes right now?'
        ];
        return en[Math.floor(Math.random() * en.length)];
    }
}
