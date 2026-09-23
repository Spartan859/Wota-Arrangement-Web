export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorPayload(error: unknown) {
  if (error instanceof AppError)
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  return {
    statusCode: 500,
    code: "internal_error",
    message: "服务器处理失败，请稍后重试。",
  };
}
