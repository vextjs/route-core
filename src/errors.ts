export class RouteCoreError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

export class InvalidMethodError extends RouteCoreError {
  constructor(message = "Invalid HTTP method") {
    super(message, "ERR_INVALID_METHOD")
  }
}

export class InvalidPathError extends RouteCoreError {
  constructor(message = "Invalid route path") {
    super(message, "ERR_INVALID_PATH")
  }
}

export class InvalidStoreIdError extends RouteCoreError {
  constructor(message = "storeId must be a non-negative safe integer") {
    super(message, "ERR_INVALID_STORE_ID")
  }
}

export class RouteConflictError extends RouteCoreError {
  constructor(message = "Route already exists for this method and path shape") {
    super(message, "ERR_ROUTE_CONFLICT")
  }
}
