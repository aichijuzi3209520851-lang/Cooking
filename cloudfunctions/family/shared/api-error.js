// cloudfunctions/shared/api-error.js - 统一 API 错误类型
// 所有云函数共享此错误类，返回稳定 errorCode 供前端区分场景

class ApiError extends Error {
  constructor(errorCode, message) {
    super(message)
    if (message === undefined) {
      this.message = undefined
    }
    this.errorCode = errorCode
  }
}

module.exports = { ApiError }
