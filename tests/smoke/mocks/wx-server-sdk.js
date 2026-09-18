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
  async getTempFileURL({ fileList }) {
    // 内容安全检测需要 https 临时链接；桩直接返回固定前缀，保证链路可跑通
    return {
      fileList: (fileList || []).map((fileID) => ({
        fileID,
        status: 0,
        tempFileURL: `https://mock.tcb.example/${encodeURIComponent(fileID)}`
      }))
    }
  },
  openapi: {
    subscribeMessage: {
      async send(message) {
        env.sent.push(message)
      }
    },
    security: {
      async msgSecCheck(message) {
        env.securityChecks.push({ type: 'text', message })
        return env.nextSecurityResult('text')
      },
      async imgSecCheck(message) {
        env.securityChecks.push({ type: 'image', message })
        return env.nextSecurityResult('image')
      }
    }
  }
}

module.exports = cloud
