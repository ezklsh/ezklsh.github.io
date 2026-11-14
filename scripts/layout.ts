// Ordering for the CSS-columns masonry.
//
// CSS columns places items in document order and only splits between them, so
// the sequence is the single lever for balance. This searches for the ordering
// whose best sequential cut is the most even: three columns at desktop width,
// two on tablets, weighted lower so the desktop split wins.

type Sized = { w: number; h: number }

export function layoutOrder<T extends Sized>(items: T[]): T[] {
    if (items.length < 4) return [...items]

    const aspect = (p: Sized) => p.h / p.w

    // smallest spread achievable by cutting `order` into k consecutive groups
    const spread = (order: T[], k: number) => {
        const a = order.map(aspect)
        const groupsFor = (cuts: number[]) => {
            const groups: number[] = []
            let start = 0
            for (const c of [...cuts, a.length]) {
                groups.push(a.slice(start, c).reduce((s, v) => s + v, 0))
                start = c
            }
            return groups
        }
        let best = Infinity
        if (k === 2) {
            for (let i = 1; i < a.length; i++) {
                const g = groupsFor([i])
                best = Math.min(best, Math.max(...g) - Math.min(...g))
            }
        } else {
            for (let i = 1; i < a.length - 1; i++)
                for (let j = i + 1; j < a.length; j++) {
                    const g = groupsFor([i, j])
                    best = Math.min(best, Math.max(...g) - Math.min(...g))
                }
        }
        return best
    }

    const cost = (order: T[]) => spread(order, 3) + 0.5 * spread(order, 2)

    let best = [...items]
    let bestCost = cost(best)
    for (let pass = 0; pass < 8; pass++) {
        let improved = false
        for (let i = 0; i < items.length; i++)
            for (let j = i + 1; j < items.length; j++) {
                const candidate = [...best]
                const a = candidate[i] as T
                const b = candidate[j] as T
                candidate[i] = b
                candidate[j] = a
                const c = cost(candidate)
                if (c < bestCost - 1e-6) {
                    best = candidate
                    bestCost = c
                    improved = true
                }
            }
        if (!improved) break
    }
    return best
}
