// Ordering for the CSS-columns masonry.
//
// CSS columns places items in document order and can only split between them, so
// the sequence is the single lever for balance. This searches for the ordering
// whose best sequential cut is the most even: three columns at desktop width,
// two on tablets, weighted lower so the desktop split wins.
//
// A single climb from date order gets stuck in a local optimum — measured on an
// 18-photo set it accepted no swaps at 0.50 aspect units of raggedness while
// shuffled orders reached 0.33 — so it also restarts from a fixed sequence of
// shuffles and keeps the best. The PRNG is seeded, so the same set of photos
// always produces the same page.

type Sized = { w: number; h: number }

function mulberry32(seed: number) {
    let s = seed
    return () => {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function layoutOrder<T extends Sized>(items: T[]): T[] {
    const n = items.length
    if (n < 4) return [...items]

    // a photo's height at any column width is proportional to h / w, so the
    // search works in aspect units and the result is width independent
    const weight = items.map((p) => p.h / p.w)

    // spread of the most even k-way cut of `order`, via prefix sums
    const spread = (order: number[], k: number) => {
        const pre = [0]
        for (const i of order) pre.push((pre[pre.length - 1] as number) + (weight[i] as number))
        const total = pre[n] as number
        let best = Infinity
        if (k === 2) {
            for (let i = 1; i < n; i++) {
                const a = pre[i] as number
                best = Math.min(best, Math.abs(2 * a - total))
            }
        } else {
            for (let i = 1; i < n - 1; i++)
                for (let j = i + 1; j < n; j++) {
                    const a = pre[i] as number
                    const b = (pre[j] as number) - a
                    const c = total - (pre[j] as number)
                    best = Math.min(best, Math.max(a, b, c) - Math.min(a, b, c))
                }
        }
        return best
    }

    const cost = (order: number[]) => spread(order, 3) + 0.5 * spread(order, 2)

    // pairwise swaps, accepting every improvement, until a pass finds none
    const climb = (start: number[]) => {
        let best = [...start]
        let bestCost = cost(best)
        for (let pass = 0; pass < 4; pass++) {
            let improved = false
            for (let i = 0; i < n; i++)
                for (let j = i + 1; j < n; j++) {
                    const candidate = [...best]
                    const a = candidate[i] as number
                    candidate[i] = candidate[j] as number
                    candidate[j] = a
                    const c = cost(candidate)
                    if (c < bestCost - 1e-9) {
                        best = candidate
                        bestCost = c
                        improved = true
                    }
                }
            if (!improved) break
        }
        return { order: best, cost: bestCost }
    }

    const dated = items.map((_, i) => i)
    let best = climb(dated)

    const random = mulberry32(0x5eed)
    for (let attempt = 0; attempt < n * 2; attempt++) {
        const shuffled = [...dated]
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1))
            const a = shuffled[i] as number
            shuffled[i] = shuffled[j] as number
            shuffled[j] = a
        }
        const result = climb(shuffled)
        if (result.cost < best.cost - 1e-9) best = result
    }

    return best.order.map((i) => items[i] as T)
}
