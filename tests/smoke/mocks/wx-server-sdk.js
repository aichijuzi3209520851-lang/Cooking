// wx-server-sdk 冒烟桩：把 cloud.* 映射到内存环境（tests/smoke/mocks/env.js）
const env = require('./env')

const cloud = {
  init() {},
  DYNAMIC_CURRENT_ENV: Symbol.for('DYNAMIC_CURRENT_ENV'),
  database() {
    return env.db
  },
  getWXContext() {
    return { OPENID: env.currentUser }
  },
  async callFunction({ name, data }) {
    const fn = env.functions[name]
    if (!fn) {
      const err = new Error(`FUNCTION_NOT_FOUND: ${name}`)
      err.errMsg = err.message
      throw err
    }
    const result = await fn(data)
    return { result }
  },
  async deleteFile({ fileList }) {
    env.deletedFiles.push(...(fileList || []))
    return { fileList: (fileList || []).map((f) => ({ fileID: f, status: 0 })) }
  },
  openapi: {
    subscribeMessage: {
      async send(message) {
        env.sent.push(message)
      }
    }
  }
}

module.exports = cloud
