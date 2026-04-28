export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class QuotaExceededError extends AppError {
  constructor(integradorId: string) {
    super(429, `Quota de API excedida para o integrador ${integradorId}`, 'QUOTA_EXCEEDED')
  }
}

export class UnauthorizedError extends AppError {
  constructor(msg = 'Não autorizado') {
    super(401, msg, 'UNAUTHORIZED')
  }
}

export class ForbiddenError extends AppError {
  constructor(msg = 'Acesso negado') {
    super(403, msg, 'FORBIDDEN')
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} não encontrado`, 'NOT_FOUND')
  }
}

export class ValidationError extends AppError {
  constructor(msg: string) {
    super(400, msg, 'VALIDATION_ERROR')
  }
}

export class ConflictError extends AppError {
  constructor(msg = 'Conflito') {
    super(409, msg, 'CONFLICT')
  }
}
