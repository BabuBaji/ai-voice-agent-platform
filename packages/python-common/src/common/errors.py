class AppError(Exception):
    def __init__(self, status_code: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found"):
        super().__init__(404, message, "NOT_FOUND")


class ValidationError(AppError):
    def __init__(self, message: str = "Validation failed"):
        super().__init__(400, message, "VALIDATION_ERROR")


class AuthenticationError(AppError):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(401, message, "AUTH_ERROR")
