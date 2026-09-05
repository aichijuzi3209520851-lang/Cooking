// 冒烟测试内存环境：实现云函数用到的数据库子集与 wx 上下文
// 只 mock 微信底层 SDK（wx-server-sdk / 云函数互调 / openapi），业务代码全部真实执行

function createDb() {
  const collections = new Map()

  function matches(doc, cond) {
    return Object.keys(cond).every((k) => {
      const c = cond[k]
      const v = doc[k]
      if (c && typeof c === 'object' && c.__cmd) {
        if (c.__cmd === 'in') return c.arr.includes(v)
        const a = v && typeof v.getTime === 'function' ? v.getTime() : v
        const b = c.v && typeof c.v.getTime === 'function' ? c.v.getTime() : c.v
        if (c.__cmd === 'gt') return a > b
        if (c.__cmd === 'lt') return a < b
        if (c.__cmd === 'lte') return a <= b
        return false
      }
      if (v && typeof v.getTime === 'function' && c && typeof c.getTime === 'function') {
        return v.getTime() === c.getTime()
      }
      return v === c
    })
  }

  function applyOps(doc, data) {
    for (const k of Object.keys(data)) {
      const op = data[k]
      if (op && typeof op === 'object' && op.__cmd === 'inc') {
        doc[k] = (doc[k] || 0) + op.n
      } else {
        doc[k] = op
      }
    }
  }

  function collection(name) {
    if (!collections.has(name)) collections.set(name, new Map())
    const docs = collections.get(name)

    const builder = {
      cond: {},
      orders: [],
      skipN: 0,
      limitN: 0,
      where(cond) {
        this.cond = cond || {}
        return this
      },
      orderBy(field, dir) {
        this.orders.push({ field, dir })
        return this
      },
      skip(n) {
        this.skipN = n
        return this
      },
      limit(n) {
        this.limitN = n
        return this
      },
      async get() {
        let arr = [...docs.values()].filter((d) => matches(d, this.cond))
        for (const { field, dir } of [...this.orders].reverse()) {
          arr.sort((x, y) => {
            const a = x[field]
            const b = y[field]
            const av = a && typeof a.getTime === 'function' ? a.getTime() : a
            const bv = b && typeof b.getTime === 'function' ? b.getTime() : b
            if (av === bv) return 0
            const cmp = av < bv ? -1 : 1
            return dir === 'desc' ? -cmp : cmp
          })
        }
        if (this.skipN) arr = arr.slice(this.skipN)
        if (this.limitN) arr = arr.slice(0, this.limitN)
        return { data: arr.map((d) => ({ ...d })) }
      },
      async count() {
        return { total: [...docs.values()].filter((d) => matches(d, this.cond)).length }
      },
      async update({ data }) {
        let updated = 0
        for (const d of [...docs.values()]) {
          if (matches(d, this.cond)) {
            applyOps(d, data)
            updated += 1
          }
        }
        return { stats: { updated } }
      },
      async remove() {
        let removed = 0
        for (const [id, d] of [...docs.entries()]) {
          if (matches(d, this.cond)) {
            docs.delete(id)
            removed += 1
          }
        }
        return { stats: { removed } }
      }
    }

    builder.doc = (id) => ({
      async get() {
        if (!docs.has(id)) throw new Error(`document ${id} not found`)
        return { data: { ...docs.get(id) } }
      },
      async update({ data }) {
        // 与真实 TCB 语义一致：更新不存在的文档是 no-op，不报错
        if (!docs.has(id)) return { stats: { updated: 0 } }
        applyOps(docs.get(id), data)
        return { stats: { updated: 1 } }
      },
      async remove() {
        return { stats: { removed: docs.delete(id) ? 1 : 0 } }
      },
      async set({ data }) {
        const created = !docs.has(id)
        docs.set(id, { _id: id, ...data })
        return { stats: { created: created ? 1 : 0 } }
      }
    })

    builder.add = async ({ data }) => {
      const id = data._id !== undefined ? data._id : `auto_${name}_${docs.size}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      if (docs.has(id)) throw new Error(`duplicate _id: ${id}`)
      docs.set(id, { _id: id, ...data })
      return { _id: id }
    }

    return builder
  }

  return {
    command: {
      inc: (n) => ({ __cmd: 'inc', n }),
      gt: (v) => ({ __cmd: 'gt', v }),
      lt: (v) => ({ __cmd: 'lt', v }),
      lte: (v) => ({ __cmd: 'lte', v }),
      in: (arr) => ({ __cmd: 'in', arr })
    },
    collection,
    _reset() {
      collections.clear()
    }
  }
}

const env = module.exports = {
  currentUser: '',
  sent: [],           // 订阅消息发送记录（openapi.subscribeMessage.send）
  functions: {},      // 已加载的云函数 main（供 callFunction 内部互调）
  db: createDb(),
  resetDb() {
    env.db._reset()
    env.sent.length = 0
  }
}
