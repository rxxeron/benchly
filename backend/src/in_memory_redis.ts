/**
 * In-Memory Valkey/Redis Fallback Store
 * Automatically activates when localhost:6379 is not running on the host machine,
 * ensuring 100% live Socket.IO matchmaking, room transcripts, and analytics with zero external setup.
 */
export class InMemoryRedisAdapter {
    private kv = new Map<string, { val: string; exp?: number }>();
    private lists = new Map<string, string[]>();
    private sets = new Map<string, Set<string>>();
    private hashes = new Map<string, Map<string, string>>();

    private isExpired(exp?: number): boolean {
        return exp !== undefined && Date.now() > exp;
    }

    on(_event: string, _cb: (...args: any[]) => void) {
        return this;
    }

    async get(key: string): Promise<string | null> {
        const entry = this.kv.get(key);
        if (!entry) return null;
        if (this.isExpired(entry.exp)) {
            this.kv.delete(key);
            return null;
        }
        return entry.val;
    }

    async set(key: string, val: string, mode?: string, ttlSec?: number): Promise<'OK'> {
        const exp = mode === 'EX' && ttlSec ? Date.now() + ttlSec * 1000 : undefined;
        this.kv.set(key, { val: String(val), exp });
        return 'OK';
    }

    async ttl(key: string): Promise<number> {
        const entry = this.kv.get(key);
        if (!entry || !entry.exp) return -1;
        return Math.max(0, Math.ceil((entry.exp - Date.now()) / 1000));
    }

    async expire(_key: string, _ttlSec: number): Promise<number> {
        return 1;
    }

    async del(...keys: string[]): Promise<number> {
        let count = 0;
        for (const k of keys) {
            if (this.kv.delete(k)) count++;
            if (this.lists.delete(k)) count++;
            if (this.sets.delete(k)) count++;
            if (this.hashes.delete(k)) count++;
        }
        return count;
    }

    async keys(pattern: string): Promise<string[]> {
        const prefix = pattern.replace('*', '');
        const all = new Set<string>([
            ...this.kv.keys(),
            ...this.lists.keys(),
            ...this.sets.keys(),
            ...this.hashes.keys()
        ]);
        return Array.from(all).filter((k) => k.startsWith(prefix));
    }

    async rpush(key: string, ...vals: string[]): Promise<number> {
        const list = this.lists.get(key) || [];
        list.push(...vals);
        this.lists.set(key, list);
        return list.length;
    }

    async lpop(key: string): Promise<string | null> {
        const list = this.lists.get(key);
        if (!list || list.length === 0) return null;
        return list.shift() || null;
    }

    async lrange(key: string, start: number, stop: number): Promise<string[]> {
        const list = this.lists.get(key) || [];
        const end = stop === -1 ? list.length : stop + 1;
        return list.slice(start, end);
    }

    async llen(key: string): Promise<number> {
        return (this.lists.get(key) || []).length;
    }

    async lrem(key: string, _count: number, val: string): Promise<number> {
        const list = this.lists.get(key);
        if (!list) return 0;
        const before = list.length;
        const filtered = list.filter((x) => x !== val);
        this.lists.set(key, filtered);
        return before - filtered.length;
    }

    async sadd(key: string, ...members: string[]): Promise<number> {
        const s = this.sets.get(key) || new Set<string>();
        let added = 0;
        for (const m of members) {
            if (!s.has(m)) {
                s.add(m);
                added++;
            }
        }
        this.sets.set(key, s);
        return added;
    }

    async srem(key: string, ...members: string[]): Promise<number> {
        const s = this.sets.get(key);
        if (!s) return 0;
        let removed = 0;
        for (const m of members) {
            if (s.delete(m)) removed++;
        }
        return removed;
    }

    async scard(key: string): Promise<number> {
        return (this.sets.get(key) || new Set()).size;
    }

    async smembers(key: string): Promise<string[]> {
        return Array.from(this.sets.get(key) || []);
    }

    async hset(key: string, fieldOrObj: string | Record<string, any>, val?: any): Promise<number> {
        const h = this.hashes.get(key) || new Map<string, string>();
        if (typeof fieldOrObj === 'string') {
            h.set(fieldOrObj, String(val ?? ''));
        } else {
            for (const [k, v] of Object.entries(fieldOrObj)) {
                h.set(k, String(v ?? ''));
            }
        }
        this.hashes.set(key, h);
        return h.size;
    }

    async hgetall(key: string): Promise<Record<string, string>> {
        const h = this.hashes.get(key);
        if (!h) return {};
        return Object.fromEntries(h.entries());
    }

    async incr(key: string): Promise<number> {
        const cur = parseInt((await this.get(key)) || '0', 10) + 1;
        await this.set(key, String(cur));
        return cur;
    }

    async hincrby(key: string, field: string, increment: number): Promise<number> {
        const h = this.hashes.get(key) || new Map<string, string>();
        const cur = parseInt(h.get(field) || '0', 10) + increment;
        h.set(field, String(cur));
        this.hashes.set(key, h);
        return cur;
    }

    pipeline() {
        const ops: Array<() => Promise<any>> = [];
        const self = this;
        const pipe = {
            incr(key: string) {
                ops.push(() => self.incr(key));
                return pipe;
            },
            hincrby(key: string, field: string, by: number) {
                ops.push(() => self.hincrby(key, field, by));
                return pipe;
            },
            async exec() {
                for (const op of ops) await op();
                return [];
            }
        };
        return pipe;
    }
}
